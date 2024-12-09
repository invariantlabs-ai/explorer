#!/usr/bin/env python3
"""
CLI to launch the Invariant Explorer as a Docker compose application.
"""
import os
import subprocess

def ensure_has_docker_compose():
    """
    Ensure that the user has Docker Compose installed.
    """
    try:
        p = subprocess.Popen(['docker', 'compose', '--version'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        p.communicate()

        if p.returncode != 0:
            raise Exception('Docker Compose is not installed. Please go to https://docs.docker.com/compose/install/ to install it and then re-run this command.')
    except FileNotFoundError:
        raise Exception('Docker Compose is not installed. Please go to https://docs.docker.com/compose/install/ to install it and then re-run this command.')


def launch():
    ensure_has_docker_compose()

    env = {
        **dict(os.environ),
        'APP_NAME': 'explorer-local',
        'DEV_MODE': 'true',
        'CONFIG_FILE_NAME': 'explorer.local.yml',
        'PREVIEW': '0',
        'PORT_HTTP': '80',
        'PORT_API': '8000',
        'KEYCLOAK_CLIENT_ID_SECRET': 'local-does-not-use-keycloak'
    }

    p = subprocess.Popen(['docker', 'compose', '-f', 'docker-compose.local.yml', 'up', '--build'], env=env)
    p.communicate()

    if p.returncode != 0:
        raise Exception('Failed to launch the Invariant Explorer. Please check the logs for more information.')

if __name__ == '__main__':
    launch()