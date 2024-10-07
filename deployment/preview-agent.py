"""
Simple deployment agent that deploys preview-explorer with the current state 
of the production database.

Pulls from the remote repository, syncs the production database, and rebuilds 
and relaunches the preview-explorer docker container.
"""
import subprocess
import os
import time
import pexpect
import asyncio

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
import fastapi
import uvicorn

def read_env():
    variables = {}
    
    with open('.env.local') as f:
        for line in f:
            if "=" not in line:
                continue
            lhs, rhs = line.split('=')
            variables[lhs.strip()] = rhs.strip()

    return variables


# read environment
env = read_env()

# check GH credentials
assert "GHUSER" in env and "GHTOKEN" in env, "GHUSER and GHTOKEN must be defined in .env.local, only found: " + str(env.keys())
github_user = env['GHUSER']
github_token = env['GHTOKEN']

# check preview deployment token
assert "PREVIEW_DEPLOYMENT_TOKEN" in env, "PREVIEW_DEPLOYMENT_TOKEN must be defined in .env.local"
preview_deployment_token = env['PREVIEW_DEPLOYMENT_TOKEN']

class AsyncProcess:
    def __init__(self, cmd):
        self.cmd = cmd
        self.returncode = None
    
    async def popen(self):
        # creates subprocess, and yields output line by line
        process = await asyncio.create_subprocess_shell(
            self.cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        async for line in process.stdout:
            yield line.decode()
        
        async for line in process.stderr:
            yield line.decode()

        await process.wait()

        self.returncode = process.returncode

async def redeploy():
    # git pull
    yield 'Pulling from remote...'
    child = pexpect.spawn('git pull')
    child.expect("Username for 'https://github.com':")
    child.sendline(github_user)
    child.expect(f"Password for 'https://{github_user}@github.com':")
    child.sendline(github_token)
    child.wait()
    child.close()

    yield child.before.decode()
    yield child.after.decode()

    # make sure git pull was successful
    # if child.exitstatus != 0:
    #     raise HTTPException(status_code=500, detail="Git pull failed:\n\n" + child.before.decode() + child.after.decode())
    
    # dump production database
    yield '\nDumping production database...\n'
    process = subprocess.Popen('docker exec -t explorer-database-1 bash -c "pg_dump -U postgres -h localhost invariantmonitor"', shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.PIPE)
    # write to prod.sql
    with open('prod.sql', 'wb') as f:
        f.write(process.stdout.read())
    
    yield process.stdout.read().decode()
    process.wait()

    if process.returncode != 0:
        raise HTTPException(status_code=500, detail=f"data sync with production failed ({process.returncode})")

    # print size of prod sql
    process = subprocess.Popen('du -sh ./prod.sql', shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    yield "PROD SQL SIZE:\n\n" + process.stdout.read().decode() + "\n"

    # delete current database data folder
    process = AsyncProcess('rm -rf ./data/database/*')
    async for line in process.popen():
        yield line
    
    # make sure empty database folder exists
    os.makedirs('./data/database', exist_ok=True)

    # get git commit
    process = subprocess.Popen('git log -1 --pretty=%B', shell=True, stdout=subprocess.PIPE)
    yield "GIT COMMIT MESSAGE:\n\n" + process.stdout.read().decode()
    # git commit hash
    process = subprocess.Popen('git rev-parse HEAD', shell=True, stdout=subprocess.PIPE)
    yield "\nGIT COMMIT HASH:\n\n" + process.stdout.read().decode()

    # docker-compose build + up
    PREVIEW_SCRIPT = os.getenv('PREVIEW_SCRIPT_PATH', './preview')
    # launch preview-explorer database
    process = AsyncProcess(f'{PREVIEW_SCRIPT} down && {PREVIEW_SCRIPT} build && {PREVIEW_SCRIPT} up -d database')
    async for line in process.popen():
        yield line

    yield "Loading production database into preview-explorer database..."
    # wait for database startup
    time.sleep(5)

    # load production database into preview-explorer database
    process = AsyncProcess(f'docker exec -i preview-explorer-database psql -U postgres -d invariantmonitor < prod.sql')
    async for line in process.popen():
        yield line

    yield "Launching preview-explorer..."
    # launch other services
    process = AsyncProcess(f'{PREVIEW_SCRIPT} up -d')
    async for line in process.popen():
        yield line
    
    if process.returncode != 0:
        yield "Deployment failed with return code " + str(process.returncode) + ":\n\n"
        raise HTTPException(status_code=500, detail="Deployment failed with return code " + str(process.returncode) + ":\n\n")
    yield "Deployment successful: https://preview-explorer.invariantlabs.ai is now live!"

app = FastAPI()

@app.get("/deployment")
def read_root():
    return {"message": "preview-explorer deployment agent"}

@app.post("/deployment/trigger")
async def deploy(request: fastapi.Request):
    # check header for Authorization Bearer token
    token = request.headers.get('Deployment-Token')
    if token is None or token.strip() != f'{preview_deployment_token}':
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    async def redployment():
        async for line in redeploy():
            print(line, end='', flush=True)
            yield line
    
    # stream output to client
    response = StreamingResponse(redployment())
    response.headers["Content-Type"] = "text/event-stream"
    return response

"""
To trigger deployment in curl use (assuming endpoint is <ENDPOINT>):
curl -X POST -H "Deployment-Token: <PREVIEW_DEPLOYMENT_TOKEN>" <ENDPOINT>/deployment/trigger
"""

if __name__ == '__main__':
    uvicorn.run(app, host="0.0.0.0", port=8000)