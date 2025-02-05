import json
import os
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from keycloak import KeycloakOpenID  # pip require python-keycloak
from util.config import config

is_preview_deployment = os.getenv("PREVIEW") == "1"
base_url = "https://" + os.getenv("APP_NAME") + ".invariantlabs.ai"
client_id = config("authentication_client_id_prefix") + "-" + os.getenv("APP_NAME")

if is_preview_deployment:
    client_id = client_id.replace("preview-", "")

keycloak_openid = KeycloakOpenID(
    server_url="https://auth.invariantlabs.ai/",
    client_id=client_id,
    realm_name=config("authentication_realm"),
    client_secret_key=os.getenv("KEYCLOAK_CLIENT_ID_SECRET"),
)

DEVELOPER_USER = {
    "sub": "3752ff38-da1a-4fa5-84a2-9e44a4b167ce",
    "email": "dev@mail.com",
    "username": "developer",
    "name": "Developer"
}
DEVELOPER_USER2 = {
    "sub": "3752ff38-da1a-4fa5-84a2-9e44a4b167ca",
    "email": "dev2@mail.com",
    "username": "developer2",
    "name": "Developer2"
}

def install_authorization_endpoints(app):
    """
    Call this on a fastapi app, if you want to add the /login and /logout endpoints (only UI).
    """

    @app.get("/login")
    async def login(request: Request):
        response = RedirectResponse(url="/")

        code = request.query_params.get("code")

        if code is None:
            auth_url = await keycloak_openid.a_auth_url(
                redirect_uri=f"{base_url}/login", scope="openid profile email"
            )
            return RedirectResponse(auth_url)
        try:
            access_token = await keycloak_openid.a_token(
                code=code,
                grant_type="authorization_code",
                redirect_uri=f"{base_url}/login",
                scope="openid profile email",
            )

            userinfo = await keycloak_openid.a_userinfo(access_token["access_token"])
            response.set_cookie(
                key="jwt", value=json.dumps(access_token), httponly=True
            )
        except Exception:
            import traceback

            traceback.print_exc()
            access_token = None

            auth_url = await keycloak_openid.a_auth_url(
                redirect_uri=f"{base_url}/login", scope="openid profile email"
            )
            return HTMLResponse(
                f'<br/><br/><center>Failed to login with code: {code}. <br/><br/><a href="{auth_url}">Login</a></center>'
            )

        return response

    @app.get("/logout")
    async def logout(request: Request):
        token = json.loads(request.cookies.get("jwt"))
        await keycloak_openid.a_logout(token["refresh_token"])
        response = RedirectResponse(url="/login")
        response.delete_cookie("jwt")
        return response


"""
This middleware will write back the refreshed token to the response, if it was refreshed during the request.
"""


async def write_back_refreshed_token(request: Request, call_next):
    response = await call_next(request)

    if hasattr(request.state, "refreshed_token"):
        response.set_cookie(
            key="jwt", value=json.dumps(request.state.refreshed_token), httponly=True
        )

    return response


async def UserIdentity(request: Request) -> UUID | None:
    # None stands for anonymous user
    # check for DEV_MODE
    if os.getenv("DEV_MODE") == "true" and "noauth" not in request.headers.get(
        "referer", []
    ):
        request.state.userinfo = DEVELOPER_USER
        # set jwt cookie for dev mode
        request.state.refreshed_token = {
            "access_token": "dev-access",
            "refresh_token": "dev-refresh"
        }

        return UUID(request.state.userinfo["sub"])

    if (
        "noauth=user1" in request.headers.get("referer", [])
        and os.getenv("DEV_MODE") == "true"
    ):
        request.state.userinfo = DEVELOPER_USER2
        # set jwt cookie for dev mode
        request.state.refreshed_token = {
            "access_token": "dev-access",
            "refresh_token": "dev-refresh"
        }

        return UUID(request.state.userinfo["sub"])

    try:
        token = json.loads(request.cookies.get("jwt"))
        try:
            # get user info (with current access token)
            userinfo = await keycloak_openid.a_userinfo(token["access_token"])
        except Exception:
            # if the token is expired, try to refresh it
            token = await keycloak_openid.a_refresh_token(token["refresh_token"])
            # keep refreshed token in request state
            request.state.refreshed_token = token

            userinfo = await keycloak_openid.a_userinfo(token["access_token"])
        request.state.userinfo = userinfo

        assert userinfo["sub"] is not None, "a logged-in user must have a sub"

        return UUID(userinfo["sub"])
    except Exception:
        # otherwise, this is an anonymous user

        # on private instances, we don't allow anonymous access beyond /login and /user/info
        is_private_instance = config("private")
        if is_private_instance and (
            request.url.path != "/login" and request.url.path != "/api/v1/user/info"
        ):
            raise HTTPException(
                status_code=401, detail="Private instance, login required"
            )
        request.state.userinfo = None
        # on public instances, we allow anonymous access to some endpoints. In this case, return None.
        return None


async def AuthenticatedUserIdentity(identity: Annotated[UUID | None, Depends(UserIdentity)]) -> UUID:
    if identity is None:
        raise HTTPException(status_code=401, detail="Unauthorized request")
    return identity
