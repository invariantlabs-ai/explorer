# App API

## Overview

This directory contains the backend API for the Explorer application, built using FastAPI. The API provides endpoints for managing datasets, traces, annotations, users, authentication, and analytical operations. The application interacts with a PostgreSQL database using SQLAlchemy ORM.

## Project Structure

```
app-api/
├── routes/                  # FastAPI route handlers
│   ├── apikeys.py           # API key management
│   ├── auth.py              # Authentication handling
│   ├── benchmark.py         # Performance benchmarking
│   ├── dataset.py           # Dataset CRUD operations
│   ├── dataset_metadata.py  # Metadata management for datasets
│   ├── jobs.py              # Background job processing
│   ├── push.py              # Pushing data to the service
│   ├── trace.py             # Trace CRUD operations and annotations
│   └── user.py              # User management
├── models/                  # Database models and query functions
│   ├── analyzer_model.py    # Models for data analysis
│   ├── datasets_and_traces.py # Database schema definition
│   ├── importers.py         # Data importing utilities
│   └── queries.py           # Database query functions
├── util/                    # Utility functions
├── database/                # Database connection and management
├── metrics/                 # Observability and metrics
├── assets/                  # Static assets
├── __pycache__/             # Python bytecode cache
├── requirements.in          # Direct dependencies
├── requirements.txt         # Pinned dependencies
├── serve.py                 # Main application entry point
├── logging_config.py        # Logging configuration
├── push_client.py           # Client for pushing data
├── run.sh                   # Startup script
├── Dockerfile.api           # Docker configuration for API
└── alembic.ini              # Database migration configuration
```

## Core Components

### Database Models (`models/datasets_and_traces.py`)

The application uses SQLAlchemy ORM with the following main models:

- **User**: Stores user information (not for authentication)
- **Dataset**: Represents a collection of traces
- **Trace**: Contains conversation or interaction data
- **Annotation**: Comments or notes attached to specific parts of traces
- **SharedLinks**: URLs for sharing traces with others
- **APIKey**: API authentication keys
- **DatasetPolicy**: Rules for controlling access to datasets
- **DatasetJob**: Background processing jobs for datasets

### API Routes

The API is organized into several modules:

- **trace.py**: Endpoints for managing traces and annotations
  - GET/POST/DELETE operations for traces
  - Image retrieval
  - Annotation management
  - Analysis operations
  - Sharing controls

- **dataset.py**: Dataset management
  - CRUD operations
  - Importing/exporting
  - Search and filtering
  - Policy management

- **user.py**: User account operations
  - Profile management
  - Preferences

- **auth.py**: Authentication and authorization
  - Token management
  - Session control

- **apikeys.py**: API key management for programmatic access

## Database Architecture

### Design Overview

The database uses PostgreSQL with SQLAlchemy as the ORM layer. The connection is managed through a singleton `DatabaseManager` class that provides database connection pooling capabilities with configurable parameters.

### Schema Design

The core data model centers around these relationships:
- **Users** own multiple **Datasets**
- **Datasets** contain multiple **Traces**
- **Traces** can have multiple **Annotations**
- **Traces** can be shared through **SharedLinks**

The database uses UUIDs as primary keys for most entities to ensure global uniqueness and security.

### Connection Management

Database connections are configured through environment variables:
- `POSTGRES_USER`: Database username
- `POSTGRES_PASSWORD`: Database password
- `POSTGRES_HOST`: Database host address
- `POSTGRES_DB`: Database name
- `DB_POOL_SIZE`: Connection pool size (default: 10)
- `DB_MAX_OVERFLOW`: Maximum overflow connections (default: 5)

The connection pool uses a recycle time of 30 minutes and includes connection validation (`pool_pre_ping=True`).

### Migrations

Database migrations are managed with Alembic. The migration scripts are stored in the `database/versions/` directory and can be run using Alembic CLI commands.

## Trace Management

Traces are the core data structure of the application, representing conversational data or model interactions.

### Trace Structure

A Trace object includes:
- **Content**: JSON structured data containing the conversation or interaction
- **Metadata**: Additional information about the trace
- **Hierarchical Path**: Optional organization structure
- **Ownership**: User who created the trace
- **Dataset Relationship**: Optional parent dataset
- **Index**: Position within its dataset
- **Creation Time**: When the trace was created

### Trace Operations

The system provides several key operations for trace management:

1. **Creation**:
   - Traces can be created as standalone "snippets" without a dataset
   - Traces can be created within a dataset during dataset import
   - Images in traces are extracted and stored separately as files

2. **Retrieval**:
   - Traces can be fetched individually with optional annotations
   - Traces can be filtered by dataset, user, or accessibility
   - Content length can be limited with truncation

3. **Update**:
   - New messages can be appended to existing traces
   - Message content can include text and images
   - Timestamps are preserved for proper message ordering

4. **Sharing**:
   - Traces can be shared via generated links
   - Permissions are enforced based on ownership and sharing settings

5. **Analysis**:
   - External analysis services can process trace content
   - Analysis results can be stored as annotations

### Image Handling in Traces

When traces contain images:
1. Base64-encoded images in the messages are extracted
2. Images are saved to disk at `/srv/images/{dataset_name}/{trace_id}/{image_id}.png`
3. Image references in messages are replaced with local paths
4. Images are served through a dedicated endpoint

### Special Cases

- **Snippets**: Traces without a parent dataset use `!ROOT_DATASET_FOR_SNIPPETS` as a virtual dataset name for image storage
- **Message Ordering**: When adding new messages, they are merged with existing messages based on timestamps

## API Endpoints in Detail

The API is organized into several modules mounted under `/api/v1/`. Each module provides a set of endpoints for specific functionality.

### Trace API (`/api/v1/trace/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/snippets` | GET | Retrieve trace snippets for the authenticated user |
| `/{id}` | GET | Get a specific trace by ID with optional annotations |
| `/{id}` | DELETE | Delete a trace (owner only) |
| `/{id}/download` | GET | Download a trace as a JSON file |
| `/{id}/shared` | GET | Check if a trace is shared |
| `/{id}/shared` | PUT | Enable sharing for a trace |
| `/{id}/shared` | DELETE | Disable sharing for a trace |
| `/{id}/annotate` | POST | Add a new annotation to a trace |
| `/{id}/annotations` | GET | Get all annotations for a trace |
| `/{id}/annotation/{annotation_id}` | DELETE | Delete an annotation |
| `/{id}/annotation/{annotation_id}` | PUT | Update an annotation |
| `/snippets/new` | POST | Create a new trace snippet |
| `/{trace_id}/messages` | POST | Append messages to an existing trace |
| `/image/{dataset_name}/{trace_id}/{image_id}` | GET | Retrieve an image attached to a trace |
| `/{id}/analysis` | POST | Perform analysis on a trace using external service |

### Dataset API (`/api/v1/dataset/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | List all datasets for the user |
| `/` | POST | Create a new dataset |
| `/{id}` | GET | Get a specific dataset by ID |
| `/{id}` | DELETE | Delete a dataset |
| `/{id}/traces` | GET | Get all traces in a dataset |
| `/{id}/traces/export` | GET | Export all traces in a dataset |
| `/{id}/traces/import` | POST | Import traces into a dataset |
| `/{id}/search` | GET | Search for traces in a dataset |
| `/{id}/policies` | GET | Get access policies for a dataset |
| `/{id}/policies` | PUT | Update access policies for a dataset |

### User API (`/api/v1/user/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/me` | GET | Get information about the current user |
| `/login` | POST | Authenticate a user |
| `/register` | POST | Register a new user |
| `/logout` | POST | Log out the current user |

### Authentication

The API supports two authentication methods:
1. **Token-based authentication** - For interactive user sessions
2. **API key authentication** - For programmatic access

Authentication dependencies are defined in `routes/auth.py` and `routes/apikeys.py` and injected into route handlers.

### Metrics and Observability

Metrics are exposed at a dedicated endpoint and protected by a token. The system collects:
- Request counts by endpoint
- Response times
- Error rates
- Active user statistics

## Running the API

The application can be started using:

```bash
./run.sh
```

Or directly with:

```bash
python serve.py
```

For development mode, set the `DEV_MODE` environment variable to `true`.

## Dependencies

Major dependencies include:
- FastAPI - Web framework
- SQLAlchemy - ORM for database access
- Uvicorn - ASGI server
- Alembic - Database migrations
- Prometheus - Metrics collection
- Python-multipart - Form data handling
- Pillow - Image processing
- Aiohttp/Aiofiles - Async IO operations

## Security Considerations

- API keys are stored as hashes
- Access control is enforced at the route level
- Shared resources require explicit permission
- Token validation for authenticated endpoints

## Image Handling

The application stores images associated with traces in the filesystem at:
`/srv/images/{dataset_name}/{trace_id}/{image_id}.png`

## Feature Highlights

1. **Trace Analysis**: The API supports analyzing trace content with external analysis services
2. **Annotation System**: Users can comment on specific parts of traces
3. **Sharing Capability**: Traces can be shared via generated links
4. **Hierarchical Organization**: Traces can be organized in hierarchical paths
5. **Metadata Enrichment**: Both traces and datasets support additional metadata
6. **Incremental Message Appending**: Traces can be updated with new messages over time