import { BsHouse, BsFillPersonFill, BsCircleFill, BsCircle, BsKeyFill, BsHouseFill, BsFillTerminalFill, BsSpeedometer2, BsThreeDots, BsListColumns, BsRobot, BsSearch } from 'react-icons/bs'
import Home from './Home.tsx'
import Layout from './Layout.tsx'
import {Traces, SingleTrace} from './Traces.tsx'
import './App.scss'
import DatasetView from './Dataset.tsx'
import { Link, } from 'react-router-dom'
import { New } from './New.tsx'
import { SignUp } from './SignUp.tsx'
import User from './User.tsx'
import { Snippets } from './Snippets.tsx'
import { Settings } from './Settings.tsx'
import { Datasets } from './Datasets.tsx'

export const routes = [
  {
    path: '/',
    label: 'Home',
    icon: <BsSpeedometer2/>,
    element: <Layout><Home/></Layout>,
    category: 'home'
  },
  {
    path: '/u/:username',
    label: 'User',
    element: <Layout><User/></Layout>,
    loader: async (user: any) => {
      return {"username": user.params.username}
    }
  },
  {
    path: '/u/:username/:datasetname',
    label: 'Dataset',
    element: <Layout><DatasetView/></Layout>,
    loader: async (task: any) => {
      return {"datasetname": task.params.datasetname,
              "username": task.params.username}
      }
  },
  {
    path: '/u/:username/:datasetname/t/:traceIdx',
    label: 'Dataset',
    element: <Layout fullscreen><Traces/></Layout>,
    loader: async (task: any) => {
      return {"datasetname": task.params.datasetname,
              "username": task.params.username,
              "traceIdx": task.params.traceIdx,
            }
      }
  },
  {
    path: '/u/:username/:datasetname/t',
    label: 'Dataset',
    element: <Layout fullscreen><Traces/></Layout>,
    loader: async (task: any) => {
      return {"datasetname": task.params.datasetname,
              "username": task.params.username,
              "traceId": null
            }
    }
  },
  {
    path: '/trace/:traceId',
    label: 'Dataset',
    element: <Layout fullscreen><SingleTrace/></Layout>,
    loader: async (task: any) => {
      return {
        "traceId": task.params.traceId
      }
    }
  },
  {
    path: '/new',
    label: 'Upload New Trace',
    element: <Layout needsLogin fullscreen><New/></Layout>,
    loader: async (task: any) => {
      return {}
    }
  },
  {
    path: '/signup',
    label: 'Sign Up',
    element: <Layout needsLogin><SignUp/></Layout>
  },
  // /snippets
  {
    path: '/snippets',
    label: 'Snippets',
    element: <Layout needsLogin><Snippets/></Layout>,
  },
  // /datasets
  {
    path: '/datasets',
    label: 'Datasets',
    element: <Layout needsLogin><Datasets/></Layout>,
  },
  // /settings
  {
    path: '/settings',
    label: 'Settings',
    element: <Layout needsLogin><Settings/></Layout>,
  },
  // 404
  {
    path: '*',
    label: 'Not Found',
    element: <Layout><div className='empty'>
      Not Found
    </div></Layout>,
    category: 'hidden'
  }
]