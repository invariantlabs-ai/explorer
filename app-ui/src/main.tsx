import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.scss'
import './invariant.scss'
import './App.scss'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'

import { routes } from './Routes'

const router = createBrowserRouter(routes);

ReactDOM.createRoot(document.getElementById('app-root')!).render(
  <React.StrictMode>
    <RouterProvider router={router}/>
  </React.StrictMode>,
)
