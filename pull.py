"""
Calls git pull with subprocess and enters token credentials from .env.local
"""
import subprocess
import os
# to handle interactive terminal prompts
import pexpect

with open('.env.local') as f:
    token = None
    user = None

    for line in f:
        if line.startswith('GHTOKEN='):
            token = line.split('=')[1].strip()
            continue
        elif line.startswith('GHUSER='):
            user = line.split('=')[1].strip()
            continue

    if token is None or user is None:
        raise ValueError('TOKEN and USER not found in .env.local')

# git pull
print('Pulling from remote...')
child = pexpect.spawn('git pull')
child.expect("Username for 'https://github.com':")
child.sendline(user)
child.expect(f"Password for 'https://{user}@github.com':")
child.sendline(token)
child.interact()
child.close()

# deploy (prod is docker compose)
os.system('./prod build && ./prod up -d')