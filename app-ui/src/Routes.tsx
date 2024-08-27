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
    label: 'Overview',
    icon: <BsSpeedometer2/>,
    element: <Layout><Home/></Layout>,
    category: 'home'
  },
  {
    path: '/user/:username',
    label: 'User',
    element: <Layout><User/></Layout>,
    loader: async (user: any) => {
      return {"username": user.params.username}
    }
  },
  {
    path: '/user/:username/dataset/:datasetname',
    label: 'Dataset',
    element: <Layout><DatasetView/></Layout>,
    loader: async (task: any) => {
      return {"datasetname": task.params.datasetname,
              "username": task.params.username}
      }
  },
  {
    path: '/user/:username/dataset/:datasetname/:bucketId/:traceId',
    label: 'Dataset',
    element: <Layout fullscreen><Traces/></Layout>,
    loader: async (task: any) => {
      return {"datasetname": task.params.datasetname,
              "username": task.params.username,
              "bucketId": task.params.bucketId,
              "traceId": task.params.traceId
            }
      }
  },
  {
    path: '/user/:username/dataset/:datasetname/:bucketId',
    label: 'Dataset',
    element: <Layout fullscreen><Traces/></Layout>,
    loader: async (task: any) => {
      return {"datasetname": task.params.datasetname,
              "username": task.params.username,
              "bucketId": task.params.bucketId,
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
    element: <Layout fullscreen><New/></Layout>,
    loader: async (task: any) => {
      return {}
    }
  },
  {
    path: '/signup',
    label: 'Sign Up',
    element: <Layout><SignUp/></Layout>
  },
  // /snippets
  {
    path: '/snippets',
    label: 'Snippets',
    element: <Layout><Snippets/></Layout>,
  },
  // /datasets
  {
    path: '/datasets',
    label: 'Datasets',
    element: <Layout><Datasets/></Layout>,
  },
  // /settings
  {
    path: '/settings',
    label: 'Settings',
    element: <Layout><Settings/></Layout>,
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