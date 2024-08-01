from fastapi import FastAPI,Depends
import json
from fastapi import Request, Response
from fastapi.responses import RedirectResponse, HTMLResponse
from urllib.parse import quote
from fastapi import HTTPException
from keycloak import KeycloakOpenID # pip require python-keycloak
import os

base_url = "https://" + os.getenv("APP_NAME") + ".invariantlabs.ai"
client_id = "invariant-" + os.getenv("APP_NAME")

keycloak_openid = KeycloakOpenID(
    server_url="https://auth.invariantlabs.ai/",
    client_id=client_id,
    realm_name="invariant-public",
    client_secret_key="GDq4AqlO9jWiZJ5HgIIdfhgxHyhVZnTG"
)

AUTHORIZATION_URL = "https://auth.invariantlabs.ai/realms/invariant/protocol/openid-connect/auth",
TOKEN_URL = "https://auth.invariantlabs.ai/realms/invariant/protocol/openid-connect/token",

def install_authorization_endpoints(app):
    """
    Call this on a fastapi app, if you want to add the /login and /logout endpoints (only UI).
    """
    @app.get("/login")
    async def login(request: Request):
        response = RedirectResponse(url="/")

        code = request.query_params.get("code")
        
        if code is  None:
            auth_url = keycloak_openid.auth_url(
                redirect_uri=f"{base_url}/login",
                scope="openid profile email"
            )
            return RedirectResponse(auth_url)
        try:
            # access_token = keycloak_openid.token("lbeurerkellner", "admin")
            access_token = keycloak_openid.token(
                code=code, 
                grant_type="authorization_code", 
                redirect_uri=f"{base_url}/login", 
                scope="openid profile email"
            )

            userinfo = keycloak_openid.userinfo(access_token["access_token"])
            response.set_cookie(key="jwt", value=json.dumps(access_token), httponly=True)
        except Exception as e:
            import traceback
            traceback.print_exc()
            access_token = None

            auth_url = keycloak_openid.auth_url(
                redirect_uri=f"{base_url}/login",
                scope="openid profile email"
            )
            return HTMLResponse(f'<br/><br/><center>Failed to login with code: {code}. <br/><br/><a href="{auth_url}">Login</a></center>')
        
        return response

    @app.get("/logout")
    async def logout(request: Request):
        token = json.loads(request.cookies.get("jwt"))
        keycloak_openid.logout(token["refresh_token"])
        response = RedirectResponse(url="/login")
        response.delete_cookie("jwt")
        return response

# middleware that ensure that a JWT is present in the request
def require_authorization(exceptions, redirect=False, exceptions_handler=None):
    """
    Add this to a fastapi app as a middleware, to ensure that a JWT is present and validated for all requests.

    exceptions: list of paths that should not require a JWT
    redirect: if True, redirect to /login if no JWT is present, otherwise return 401.
    """
    # same but for JWT
    async def check_jwt(request: Request, call_next):
        # check for DEV_MODE
        if os.getenv("DEV_MODE") == "true":
            request.state.userinfo = {
                "sub": "devuser4-496a-4004-950a-ef00d89c4cb7",
                "email": "dev@mail.com",
                "preferred_username": "developer",
                "name": "Developer"
            }
            return await call_next(request)

        if (request.url.path in exceptions + ["/login"]) or (exceptions_handler is not None and exceptions_handler(request)):
            response = await call_next(request)
            return response
        try:
            token = json.loads(request.cookies.get("jwt"))
            userinfo = keycloak_openid.userinfo(token["access_token"])
            request.state.userinfo = userinfo
        except Exception as e:
            print("authentication failed", e)
            if redirect:
                return RedirectResponse(url="/login")
            else:
                return Response(status_code=401, content="Unauthorized.")
        return await call_next(request)
    return check_jwt