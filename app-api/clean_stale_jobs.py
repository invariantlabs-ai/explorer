#!/usr/bin/env python
"""
Script to clean up stale jobs directly, bypassing the API.
Run this script directly from the server to clean up stale jobs.
"""

import asyncio
from models.datasets_and_traces import db, DatasetJob
from sqlalchemy.orm import Session
from routes.jobs import cleanup_stale_jobs

async def main():
    """Clean up all stale jobs."""
    print("Cleaning up stale jobs...")
    await cleanup_stale_jobs(force_all=True)
    print("Done cleaning up stale jobs!")

    # Count remaining jobs
    with Session(db()) as session:
        remaining_jobs = session.query(DatasetJob).count()
        print(f"Remaining jobs: {remaining_jobs}")

if __name__ == "__main__":
    asyncio.run(main())