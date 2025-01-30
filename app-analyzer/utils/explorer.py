import os
from utils.auth import AUTHENTICATION_INSTANCE, AuthenticatedExplorerIdentity
from fastapi import Request
import aiohttp

import fastapi
from fastapi import HTTPException, Request, Depends

class Explorer:
    """
    A reference to an authenticated Explorer instance, to be used to query the Explorer API
    on behalf of the current user (based on the request).

    This is not an SDK client, as it only encapsulates the API key and the base URL of the Explorer service.
    """
    def __init__(self, apikey: str):
        self.apikey = apikey
        self.baseurl = AUTHENTICATION_INSTANCE

    def headers(self):
        """Returns the headers to be used to authenticate requests to the Explorer API."""
        return {
            # the user's API key
            "Authorization": "Bearer " + self.apikey,
            # header to indicate via which service the request is being made
            "X-Invariant-Service": os.getenv("APP_NAME", "invariant-service")
        }
    
    def endpoint(self, path):
        """Returns the full URL for the given path."""
        return self.baseurl + path

async def AuthenticatedExplorer(request: Request, identity: dict = Depends(AuthenticatedExplorerIdentity)):
    """
    Returns an Explorer instance for the authenticated user.
    """
    apikey = identity.get("INVARIANT_API_KEY")
    if apikey is None:
        raise HTTPException(status_code=401, detail="This operation is not available to in-browser users. Please use this endpoint with an Invariant API key instead.")
    
    return Explorer(apikey)