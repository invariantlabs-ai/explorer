# Invariant Explorer

A tool for visualizing and exploring agent traces. [Hosted Version](https://explorer.invariantlabs.ai).

<img width="1396" alt="image" src="https://github.com/user-attachments/assets/91829aa5-8385-4c3e-9bff-1d8d7a8202ae" />

## Getting Started

Prerequisites: [Docker Compose](https://docs.docker.com/compose/install/)

To pull and launch Explorer, run the following commands:

```
# install Invariant package
pip install invariant-ai

# pull and launch Explorer application
invariant explorer
```
You can then access your Explorer instance via `http://localhost`. Data will be stored at `./data` of the current working directory.

Alternatively, you can try the _public and managed instance_ at [https://explorer.invariantlabs.ai](https://explorer.invariantlabs.ai).

## Development Setup

To get started, run the following command. Make sure you first install [Docker Compose](https://docs.docker.com/compose/install/).

To run the setup locally:
```bash
make up
```
To open the Explorer interface go to `http://localhost`.
This will automatically launch a local Explorer instance on your machine.

All data will be stored in `./data`. To reset the data, simply delete the `./data` directory.

### Tests
To run tests locally first turn off the app
```bash
make down
```
And then run tests
```bash
make tests
make down
```
The `make down` guarantees that you can then run `make up` again. You can skip it if you are planning un run tests again.
