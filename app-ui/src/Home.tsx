import React from 'react'
import {useUserInfo} from './UserInfo'
import { BsGlobe, BsDatabase, BsJustify } from 'react-icons/bs'
import { Link, useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import { Time } from './components/Time'
import { useSnippetsList } from './lib/snippets'
import { useDatasetList } from './lib/datasets'
import { DatasetLinkList, DeleteDatasetModalContent, UploadDatasetModalContent } from './Datasets'

import "./Home.scss"
import { CompactSnippetList } from './Snippets'

function useActivity(): [any[], () => void] {
  const [activity, setActivity] = React.useState<any[]>([])

  const refresh = () => {
    fetch('/api/v1/user/events').then(response => {
      if (response.ok) {
        response.json().then(data => {
          setActivity(data)
        })
      }
    })
  }

  React.useEffect(() => refresh(), [])

  return [
    activity,
    refresh
  ]
}

function Home() {
  const userInfo = useUserInfo()
  
  const [datasets, refresh] = useDatasetList(8)
  const [snippets, refreshSnippets] = useSnippetsList() 
  const [showUploadModal, setShowUploadModal] = React.useState(false)
  const [selectedSnippetForDelete, setSelectedSnippetForDelete] = React.useState(null)
  const [activity, refreshActivity] = useActivity()
  const navigate = useNavigate()
  
  return <>
    {/* upload modal */}
    {showUploadModal && <Modal title="Upload Dataset" onClose={() => setShowUploadModal(false)} hasWindowControls>
      <UploadDatasetModalContent onClose={() => setShowUploadModal(false)} onSuccess={refresh}/>
    </Modal>}
    <h2 className='home'>Home</h2>
    {/* user-personal snippets and datasets */}
    {userInfo?.loggedIn && <div className='mosaic'>
      <div className='box'>
        <h2>
          <Link to='/datasets'>Datasets</Link>
          <button className='inline primary' onClick={() => setShowUploadModal(true)}>New Dataset</button>
        </h2>
        <DatasetLinkList datasets={datasets.filter(dataset => dataset.user?.id == userInfo?.id)} icon={<BsDatabase />} />
      </div>
      <div className='box'>
        <h2>
          <Link to='/snippets'>Snippets</Link>
          <button className='inline primary' onClick={() => navigate('/new')}>New Trace</button>
        </h2>
        <CompactSnippetList icon={<BsJustify />} snippets={snippets} limit={8} />
      </div>
    </div>}
    {/* public datasets */}
    <div className='box'>
      <h2>Public Datasets</h2>
      <DatasetLinkList datasets={datasets.filter(dataset => dataset.is_public)} icon={<BsGlobe />} />
    </div>
    {/* user activity */}
    <ul className='box activity'>
      <h2>Activity</h2>
      {activity.map((event, i) =>
      <div className='item' onClick={() => navigate(
        {'dataset':  '/u/' + event.user.username + '/' + event.details.name,
        'trace': '/trace/' + event.details.id,
        'annotation': '/trace/' + event.details?.trace?.id
        }[event.type])
      } key={i}>
        <li className='event'>
          <div className='event-info'>
            <div className='user'>
              <img src={"https://www.gravatar.com/avatar/" + event.user.image_url_hash} />
              <div className='left'>
                <div><Link to={`/u/${event.user.username}`}><b>{event.user.username}</b></Link> {event.text}</div>
                <div className='event-time'><Time text={true}>{event.time}</Time></div>
              </div>
            </div>
          </div>
          <ActivityDetail event={event} />
          {/* <h3>{event.text +
              {'dataset': ': ' + event.details.name,
                'trace': '',
                'annotation': ''
              }[event.type]}</h3>
          <span className='description'>
          {
              {'dataset': ' ' + event.details.extra_metadata,
                'trace': event.details.extra_metadata,
                'annotation': event.details.content
              }[event.type]
          }
          </span> */}
        </li>
      </div>
      )}
      {activity.length === 0 && <div className='empty'>No activity</div>}
    </ul>
  </>
}

function ActivityDetail(props) {
  const event = props.event

  if (event.type == "dataset") {
    return <div className='event-detail'>
      <b><BsDatabase/> {event.details.name}</b>
    </div>
  } else if (event.type == "trace") {
    return <div className='event-detail'>
      <b><BsJustify/> {event.details.id}</b>
    </div>
  } else if (event.type == "annotation") {
    return <div className='event-detail'>
      In <em style={{fontFamily: 'monospace'}}>{event.details.id}</em>
      <div className='content'>
        {event.details.content}
      </div>
    </div>
  } else {
    return null; // unknown event type
  }
}

export default Home
