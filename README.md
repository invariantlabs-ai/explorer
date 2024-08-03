# Invariant App Template

Simple template of 3 docker services, that allow to host an authenticated invariant application using auth.invariantlabs.ai as the authentication provider.

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
