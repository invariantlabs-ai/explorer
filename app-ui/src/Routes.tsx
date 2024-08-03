import { BsHouse, BsFillPersonFill, BsCircleFill, BsCircle, BsKeyFill, BsHouseFill, BsFillTerminalFill, BsSpeedometer2, BsThreeDots, BsListColumns, BsRobot } from 'react-icons/bs'

import Home from './Home.tsx'
import Layout from './Layout.tsx'
import Traces from './Traces.tsx'
import './App.scss'
import Dataset from './Dataset.tsx'

export const routes = [
  {
    path: '/',
    label: 'Overview',
    icon: <BsSpeedometer2/>,
    element: <Layout><Home/></Layout>,
    category: 'home'
  },
  {
    path: '/dataset/:datasetId',
    label: 'Dataset',
    element: <Layout><Dataset/></Layout>,
    loader: async (task: any) => {
      return {"datasetId": task.params.datasetId}
    }
  },
  {
    path: '/dataset/:datasetId/:bucketId/:traceId',
    label: 'Dataset',
    element: <Layout fullscreen><Traces/></Layout>,
    loader: async (task: any) => {
      return {
        "datasetId": task.params.datasetId,
        "bucketId": task.params.bucketId,
        "traceId": task.params.traceId
      }
    }
  },
  {
    path: '/dataset/:datasetId/:bucketId',
    label: 'Dataset',
    element: <Layout fullscreen><Traces/></Layout>,
    loader: async (task: any) => {
      return {
        "datasetId": task.params.datasetId,
        "bucketId": task.params.bucketId,
        "traceId": null
      }
    }
  },
  {
    path: '/dataset/:datasetId/:bucketId',
    label: 'Dataset',
    element: <Layout fullscreen><Traces/></Layout>,
    loader: async (task: any) => {
      return {
        "datasetId": task.params.datasetId,
        "bucketId": task.params.bucketId,
        "traceId": null
      }
    }
  },
]