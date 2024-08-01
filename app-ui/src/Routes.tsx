import { BsHouse, BsFillPersonFill, BsCircleFill, BsCircle, BsKeyFill, BsHouseFill, BsFillTerminalFill, BsSpeedometer2, BsThreeDots, BsListColumns, BsRobot } from 'react-icons/bs'

import Home from './Home.tsx'

function Layout(props: { children: React.ReactNode }) {
  return <div className='layout'>
    {props.children}
  </div>
}

export const routes = [
  {
    path: '/',
    label: 'Overview',
    icon: <BsSpeedometer2/>,
    element: <Layout><Home/></Layout>,
    category: 'home'
  }
]