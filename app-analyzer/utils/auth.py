import os
import fastapi
from fastapi import HTTPException, Request, Depends
from typing import Annotated

import aiohttp

assert "AUTHENTICATION_INSTANCE" in os.environ, "AUTHENTICATION_INSTANCE must be set to the Explorer instance to use for identity validation"
AUTHENTICATION_INSTANCE = os.environ["AUTHENTICATION_INSTANCE"]

async def AuthenticatedExplorerIdentity(request: Request):
    """
    Ensures the the request is authenticated with an Explorer instance at AUTHENTICATION_INSTANCE.

    This can be via API key or JWT cookie, depending on the setting (in-browser use or programmatic use).

    Returns False if the request is not authenticated in any way.
    """
    headers = request.headers

    # needs either 'Authorization' header or JWT cookie
    if "Authorization" not in headers and "jwt" not in request.cookies:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    if jwt := request.cookies.get("jwt"):
        # check JWT
        endpoint = f"{AUTHENTICATION_INSTANCE}/api/v1/user/identity"
        
        async with aiohttp.ClientSession() as session:
            # send cookie along
            async with session.get(endpoint, cookies={"jwt": jwt}) as response:
                if response.status != 200:
                    raise HTTPException(status_code=401, detail="Unauthorized")
                return {
                    **(await response.json()),
                    "apiKey": None
                }
    else:
        # check API key via authentication instance but pass it as header
        apikey = headers.get("Authorization")
        endpoint = f"{AUTHENTICATION_INSTANCE}/api/v1/user/identity"

        async with aiohttp.ClientSession() as session:
            async with session.get(endpoint, headers={"Authorization": apikey}) as response:
                if response.status != 200:
                    raise HTTPException(status_code=401, detail="Unauthorized")
                return {
                    **(await response.json()),
                    "INVARIANT_API_KEY": apikey.split(" ")[1]
                }
    
    return False
