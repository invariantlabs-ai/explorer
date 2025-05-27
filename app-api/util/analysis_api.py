from typing import Dict, List, Any, Optional
import aiohttp
import fastapi

from models.analyzer_model import (
    JobResponseUnion,
    JobResponseParser,
)

from typing import Optional

def cookies_xor_header(apikey: str | None = None, jwt: Optional[str] = None, default_headers: Optional[dict] = None) -> dict:
    """
    Helper function to create headers for analysis model requests.

    Uses either an API key or JWT token for authentication (never both).
    """
    request_headers = default_headers.copy() if default_headers else {}
    request_cookies = {}
    if apikey:
        request_headers["Authorization"] = f"Bearer {apikey}"
    elif jwt:
        request_headers["Cookie"] = f"jwt={jwt}"
    return {'headers': request_headers, 'cookies': request_cookies}

class AnalysisClient:
    """
    API client for using the Invariant Analysis API (guardrails synthesis, analysis, etc.) from the Explorer backend.

    Supports both API key-based authentication, as well as JWT-cookie passing.
    """

    def __init__(self, base_url: str, apikey: Optional[str] = None, jwt: Optional[str] = None, request: fastapi.Request = None):
        """
        Arguments:
            base_url (str): Base URL of the analysis API (required).
            apikey (Optional[str]): API key for authentication (if available).
            jwt (Optional[str]): JWT token for authentication (if available).
            request (fastapi.Request): Context FastAPI request object, if available. Will be used to extract a jwt cookie if not provided.
        """
        if jwt is None and request is not None:
            jwt = request.cookies.get("jwt")
        
        if apikey:
            headers = {"Authorization": f"Bearer {apikey}"}
        elif jwt:
            headers = {"Cookie": f"jwt={jwt}"}
        else:
            raise ValueError("Either apikey or jwt must be provided")
        
        self.session = aiohttp.ClientSession(base_url=base_url, headers=headers)

    async def status(self, job_id: str) -> JobResponseUnion:
        """
        Checks the status of a job by its ID.
        """
        async with self.session.get(f"/api/v1/analysis/job/{job_id}") as resp:
            resp.raise_for_status()
            return JobResponseParser.model_validate(await resp.json()).root

    async def cancel(self, job_id: str) -> Optional[Dict[str, Any]]:
        """
        Cancels a job by its ID.
        Returns:
            Optional[Dict[str, Any]]: The response from the API, or None if no content.
        """
        async with self.session.put(f"/api/v1/analysis/job/{job_id}/cancel") as resp:
            resp.raise_for_status()
            return await resp.json() if resp.content_length else None

    async def delete(self, job_id: str) -> Optional[Dict[str, Any]]:
        """
        Deletes a job by its ID.
        """
        async with self.session.delete(f"/api/v1/analysis/job/{job_id}") as resp:
            resp.raise_for_status()
            return await resp.json() if resp.content_length else None

    async def queue(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Submits a job to the analysis API.
        """
        async with self.session.post("/api/v1/analysis/job", json=payload) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def jobs(self) -> List[Dict[str, Any]]:
        """
        Retrieves a list of all analysis jobs.
        """
        async with self.session.get("/api/v1/analysis/job") as resp:
            resp.raise_for_status()
            return await resp.json()

    async def close(self) -> None:
        """
        Close the aiohttp session.
        """
        await self.session.close()

    async def stream(self, **kwargs):
        """
        Stream the response from the analysis API line by line.

        This can be used for SSE responses or other streaming endpoints.

        Arguments:
            **kwargs: keyword arguments, internally passed to aiohttp request(...) method (e.g. url, json, headers, etc.).
        """
        async with self.session.request(**kwargs) as resp:
            resp.raise_for_status()
            async for line in resp.content:
                yield line.decode('utf-8')

    async def post(self, url: str, **kwargs) -> aiohttp.ClientResponse:
        """
        Perform a POST request to the analysis API.

        Arguments:
            url (str): The URL to post to.
            **kwargs: Additional keyword arguments for the request (e.g. json, headers, etc.).

        Returns:
            aiohttp.ClientResponse: The response from the POST request.
        """
        return await self.session.post(url, **kwargs)
    
    async def __aenter__(self) -> "AnalysisClient":
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.close()