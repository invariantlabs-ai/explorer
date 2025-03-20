"""
Client for the analysis model service.
"""

from typing import Dict, List, Any, Optional
import aiohttp
from models.analyzer_model import JobResponseUnion, JobResponseParser


class AnalysisClient:
    """API client for the analysis model service."""

    def __init__(self, base_url: str, apikey: Optional[str] = None) -> None:
        headers = {"Authorization": f"Bearer {apikey}"} if apikey else {}
        self.session = aiohttp.ClientSession(base_url=base_url, headers=headers)

    async def generate_policy(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Call the policy generation API endpoint."""
        async with self.session.post("/api/v1/trace-analyzer/generate-policy", json=payload) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def status(self, job_id: str) -> JobResponseUnion:
        async with self.session.get(f"/api/v1/analysis/job/{job_id}") as resp:
            resp.raise_for_status()
            return JobResponseParser.model_validate(await resp.json()).root

    async def cancel(self, job_id: str) -> Optional[Dict[str, Any]]:
        async with self.session.put(f"/api/v1/analysis/job/{job_id}/cancel") as resp:
            resp.raise_for_status()
            return await resp.json() if resp.content_length else None

    async def delete(self, job_id: str) -> Optional[Dict[str, Any]]:
        async with self.session.delete(f"/api/v1/analysis/job/{job_id}") as resp:
            resp.raise_for_status()
            return await resp.json() if resp.content_length else None

    async def queue(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        async with self.session.post("/api/v1/analysis/job", json=payload) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def jobs(self) -> List[Dict[str, Any]]:
        async with self.session.get("/api/v1/analysis/job") as resp:
            resp.raise_for_status()
            return await resp.json()

    async def close(self) -> None:
        await self.session.close()

    async def __aenter__(self) -> "AnalysisClient":
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.close()