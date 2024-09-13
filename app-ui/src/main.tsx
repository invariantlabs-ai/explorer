import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.scss'
import './invariant.scss'
import './App.scss'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'

import { routes } from './Routes'

const router = createBrowserRouter(routes);

/** override window.alert to show errors in a nice way without blocking the UI */
window.alert = (message: string) => {
  // get #alert-error-list element
  const alertErrorList = document.getElementById('alert-error-list');
  // create a li element
  const li = document.createElement('li');

  // set the text of the li element to the message
  li.textContent = message;

  // append the li element to the alertErrorList
  alertErrorList?.appendChild(li);
  // add appearance animation
  li.classList.add('appear');

  // after 5 seconds remove the li element
  setTimeout(() => {
    alertErrorList?.removeChild(li);
  }, 5000);
}

ReactDOM.createRoot(document.getElementById('app-root')!).render(
  <React.StrictMode>
    <RouterProvider router={router}/>
  </React.StrictMode>,
)
