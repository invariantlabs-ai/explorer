# App UI

## Overview

This directory contains the frontend React application for the Explorer. It's a modern, component-based UI that interacts with the backend API to display and manage datasets, traces, annotations, and user information.

## Project Structure

```
app-ui/
├── src/                    # Source code
│   ├── assets/             # Static assets like images and markdown files
│   ├── components/         # Reusable UI components
│   ├── layouts/            # Page layout components
│   ├── lib/                # Utility libraries
│   ├── pages/              # Page components for different routes
│   │   ├── home/           # Home page
│   │   ├── traces/         # Trace viewing pages
│   │   ├── snippets/       # Snippet management
│   │   ├── setting/        # Settings page
│   │   └── new-trace/      # New trace creation page
│   ├── service/            # API integration services
│   │   ├── RemoteResource.tsx  # Core API request handler
│   │   ├── DatasetOperations.tsx # Dataset-specific API operations
│   │   └── SharedFetch.tsx  # Shared fetch utility
│   ├── styles/             # CSS and SCSS files
│   ├── utils/              # Utility functions
│   ├── main.tsx            # Application entry point
│   └── Routes.tsx          # Application routing
├── public/                 # Public static assets
├── server/                 # Server-side code
├── node_modules/           # npm dependencies
├── package.json            # Project configuration and dependencies
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite configuration
└── index.html              # HTML entry point
```

## Backend Connectivity

### Core API Service Architecture

The frontend connects to the backend API primarily through the following service layers:

1. **SharedFetch**: A utility function that optimizes API requests by combining duplicate calls
2. **RemoteResource**: A class-based API client that manages CRUD operations for resources
3. **DatasetOperations**: Specialized functions for dataset-related API operations

### API Request Handling

#### SharedFetch

The `sharedFetch` function in `src/service/SharedFetch.tsx` is the foundation of API communication. It implements a caching mechanism so multiple components requesting the same resource only trigger a single HTTP request.

```typescript
export function sharedFetch(url: string): Promise<any> {
  // Cache existing requests to the same URL
  if (MULTILISTENER_FETCHES[url]) {
    return new Promise((resolve, reject) => {
      MULTILISTENER_FETCHES[url].push({ resolve, reject });
    });
  }

  // Make a new request if not already in progress
  return new Promise((resolve, reject) => {
    MULTILISTENER_FETCHES[url] = [{ resolve, reject }];
    fetch(url)
      .then((response) => {
        if (response.ok) {
          return response.json();
        } else {
          // Handle errors...
        }
      })
      // Process and distribute results...
  });
}
```

#### RemoteResource

The `RemoteResource` class in `src/service/RemoteResource.tsx` provides a higher-level abstraction for working with API resources. It handles:

- Fetching data from the API
- Updating resources
- Creating new resources
- Deleting resources
- Managing loading and error states

Components can use the `useRemoteResource` hook to interact with this class.

### Key API Endpoint Connections

The frontend connects to various API endpoints based on user actions:

#### Trace Endpoints

| UI Action | API Endpoint | Method | Component/File |
|-----------|-------------|--------|----------------|
| View a single trace | `/api/v1/trace/{id}` | GET | `SingleTrace` in `pages/traces/Traces.tsx` |
| Create a trace snippet | `/api/v1/trace/snippets/new` | POST | `NewTrace` in `pages/new-trace/NewTrace.tsx` |
| Share a trace | `/api/v1/trace/{id}/shared` | PUT | `useTraceShared` in `pages/traces/Traces.tsx` |
| Unshare a trace | `/api/v1/trace/{id}/shared` | DELETE | `useTraceShared` in `pages/traces/Traces.tsx` |
| Delete a trace | `/api/v1/trace/{id}` | DELETE | `traceDelete` in `lib/snippets.tsx` |
| List user's snippets | `/api/v1/trace/snippets` | GET | `useSnippetsList` in `lib/snippets.tsx` |

#### Dataset Endpoints

| UI Action | API Endpoint | Method | Component/File |
|-----------|-------------|--------|----------------|
| List datasets | `/api/v1/dataset/list` | GET | `useDatasetList` in `service/DatasetOperations.tsx` |
| Get dataset details | `/api/v1/dataset/byuser/{username}/{datasetname}` | GET | `useDataset` in `pages/traces/Traces.tsx` |
| Get traces in a dataset | `/api/v1/dataset/byuser/{username}/{datasetname}/traces` | GET | `LightweightTraces.batchFetch` in `pages/traces/Traces.tsx` |
| Create a dataset | `/api/v1/dataset/create` | POST | `createDataset` in `service/DatasetOperations.tsx` |
| Upload a dataset | `/api/v1/dataset/upload` | POST | `uploadDataset` in `service/DatasetOperations.tsx` |

#### User and Authentication Endpoints

| UI Action | API Endpoint | Method | Component/File |
|-----------|-------------|--------|----------------|
| Get user info | `/api/v1/user/me` | GET | `useUserInfo` in `utils/UserInfo.tsx` |
| List API keys | `/api/v1/keys/list` | GET | `useApiKeys` in `pages/setting/Settings.tsx` |

### Authentication Flow

The application handles user authentication through token-based authentication. Authentication state is maintained via:

1. The `useUserInfo` hook in `utils/UserInfo.tsx`, which fetches and caches the current user's information
2. Protected routes that redirect unauthenticated users to the login page
3. API requests that automatically include authentication tokens

### Data Fetching Patterns

The application uses several patterns for data fetching:

1. **React hooks**: Custom hooks like `useDataset`, `useTraceShared`, and `useApiKeys` encapsulate API calls
2. **Effect-based fetching**: Most data is loaded in `useEffect` hooks that trigger when component props change
3. **Cached responses**: The `sharedFetch` utility prevents duplicate requests
4. **Lazy loading**: The `LightweightTraces` class implements on-demand loading of trace data

### Real-time Updates

For certain features, the application implements real-time updates using:

1. Polling mechanisms for refreshing data
2. Callbacks that update UI state when data changes
3. The streaming API for real-time analysis results

## Using the API in Components

Components typically interact with the API in three ways:

1. **Through custom hooks**:
   ```jsx
   const [datasets, refreshDatasets] = useDatasetList("private");
   ```

2. **Direct API calls**:
   ```jsx
   sharedFetch(`/api/v1/trace/${traceId}`)
     .then(data => setTrace(data))
     .catch(error => handleError(error));
   ```

3. **Through the RemoteResource class**:
   ```jsx
   const [data, status, error, resource] = useRemoteResource(
     SomeDataLoader,
     fetchUrl,
     updateUrl
   );
   ```

## Error Handling

API errors are handled consistently throughout the application:

1. HTTP error responses trigger `catch` blocks that update component state
2. User-friendly error messages are displayed using the custom `alert` function
3. Components provide fallback UI for error states

## Building and Running

To start the development server:

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The development server will automatically proxy API requests to the backend server.

## Dependencies

Key dependencies include:
- React - UI library
- React Router - Navigation
- TypeScript - Type safety
- Vite - Build tool and development server
- React Icons - Icon library
- PostHog - Analytics (optional)