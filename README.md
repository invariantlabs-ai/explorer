# Invariant Explorer

The explorer project consist of 3 main docker compose services: `app-api`, `app-ui` and a Postgres `database`. 

For local development, just run 

```
# create data folders
mkdir data
mkdir data/database data/datasets data/pgadmin

# launch the dev environment
./dev up
```

This will spin up a local deployment of the explorer application at `https://localhost` (note the HTTPS). If you are getting certificate errors, make sure you follow the steps described at the bottom of this README, to use your self-signed certificates for local use or just waive the certificate warnings.

## Project Components

* `app-ui` includes the frontend code that communciates with the API services located at `/api/v1/*`.
* `app-api` implements the backend API as FastAPI application. It uses SQLAlchemy for database mappings, with the main datamodel in `app-api/models/datasets_and_traces.py`.

## Local Development vs. Production

**Authentication** In local development (via the `./dev` script), authentication is mocked, and the application behaves as if a user was logged in all the time. In production, authentication is implemented via the Keycloak service hosted at `auth.invariantlabs.ai`. For this, all endpoints of the API and the UI require a JWT token to be sent with every request, which enables the API to be authenticated.

**UI Serving** In local development, the UI is hot-reloaded via [Vite](https://vitejs.dev), which allows live editing. The `app-api` is also hot-reloaded via `uvicorn`. In production, the UI is built and served using `app-ui/server/serve.py`. To serve both the UI and the API via the same host, [traefik](https://traefik.io) is used for reverse proxying. 

To better understand the differences between a production and a local deployment, compare `docker-compose.yml` (local) and `docker-compose.prod.yml` (production). 

## Deployment

On the `root@invariant` platform server, go to the `~/www/explorer` directory and run `python3 pull.py` to pull the `main` branch of this repository, re-build the docker images and deploy the latest `explorer` application.

## Invariant App Template

**Template Instance** This project uses the Invariant app template with `APP_NAME` set to `explorer`. Apart from this most configuration still behaves as described below.

The app template is a simple template of 3 docker services that allow to host an authenticated invariant application using auth.invariantlabs.ai as the authentication provider.

To use this template, update `APP_NAME` in the `dev` and `prod` scripts, and update the 3 `auth.py` files as described below for the production authentication with `auth.invariantlabs.ai`.

## Local Development

For local development, you can run the following command:

```
./dev up
```

This serves a local traefik instance that routes to the frontend and backend services, both accessible at `https://localhost` (https, to resolve the SSL warnings, see below).

> The local setup always uses an authenticated mock user that is automatically logged in.

## Production Deployment

For production deployment, you can run the following command on an invariant server. 

```
./prod up
```

This assumes that there is already a traefik instance running on the server, and that the `web` network is already created. Deploying the services, will automatically make them available at `$APP_NAME.invariantlabs.ai` (up to the DNS configuration).

## Production Authentication

For production, the authentication is done via the `auth.invariantlabs.ai` [Keycloak](https://www.keycloak.org/) instance. For this to work, make sure all `auth.py` files are correctly configured with respecto to:

* The authentication realm
* The client ID
* The client secret


## Getting Started

TODO

## Remove SSL warnings via Self-Signed Certificates

To locally run your own SSL certificates, you can generate a self-signed certificate using `mkcert`. 

For this, first install [`mkcert`](https://github.com/FiloSottile/mkcert) and generate and install a local CA.

Then, go to `certs/` and run the following commands:

```
mkcert localhost
```
