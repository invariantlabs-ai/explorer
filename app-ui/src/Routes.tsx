import { BsHouse, BsFillPersonFill, BsCircleFill, BsCircle, BsKeyFill, BsHouseFill, BsFillTerminalFill, BsSpeedometer2, BsThreeDots, BsListColumns, BsRobot } from 'react-icons/bs'

import Home from './Home.tsx'
import Layout from './Layout.tsx'
import './App.scss'

export const routes = [
  {
    path: '/',
    label: 'Overview',
    icon: <BsSpeedometer2/>,
    element: <Layout><Home/></Layout>,
    category: 'home'
  }
]