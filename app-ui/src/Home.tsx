import React from 'react'
import { useUserInfo } from './UserInfo'
import { BsGlobe, BsDatabase, BsJustify } from 'react-icons/bs'
import { Link, useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import { Time } from './components/Time'
import { useSnippetsList } from './lib/snippets'
import { useDatasetList } from './lib/datasets'
import { DatasetLinkList, DeleteDatasetModalContent, UploadDatasetModalContent } from './Datasets'

import "./Home.scss"
import { CompactSnippetList } from './Snippets'

// fetches user activity from backend
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

/**
 * Home screen compopnents, including user's datasets and snippets, public datasets, and user activity.
 */
function Home() {
  const userInfo = useUserInfo()

  // fetch datasets and snippets
  const [datasets_homepage, refreshHomepageDataset] = useDatasetList("homepage", 8)
  const [datasets_private, refreshPrivateDataset] = useDatasetList("private", 8)
  const [snippets, refreshSnippets] = useSnippetsList()
  // tracks whether the Upload Dataset modal is open
  const [showUploadModal, setShowUploadModal] = React.useState(false)
  // fetch user activity
  const [activity, refreshActivity] = useActivity()
  // used to navigate to a new page
  const navigate = useNavigate()

  return <>
    {/* upload modal */}
    {showUploadModal && <Modal title="Create Dataset" onClose={() => setShowUploadModal(false)} hasWindowControls>
      <UploadDatasetModalContent onClose={() => setShowUploadModal(false)} onSuccess={refreshPrivateDataset} />
    </Modal>}
    <h2 className='home'>Home</h2>
    {/* user-personal snippets and datasets */}
    {userInfo?.loggedIn && <div className='mosaic'>
      <div className='box'>
        <h2>
          <Link to='/datasets'>Datasets</Link>
          <button className='inline primary' onClick={() => setShowUploadModal(true)}>New Dataset</button>
        </h2>
        <DatasetLinkList datasets={datasets_private} homepage={false} icon={<BsDatabase />} />
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
      <h2>Featured Datasets</h2>
      <DatasetLinkList datasets={datasets_homepage} homepage={true} icon={<BsGlobe />} />
    </div>
    {/* user activity */}
    <ul className='box activity'>
      <h2>Activity</h2>
      {activity.map((event, i) =>
        <div className='item' onClick={() => navigate(
          {
            'dataset': '/u/' + event.user.username + '/' + event.details.name,
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
          </li>
        </div>
      )}
      {activity.length === 0 && <div className='empty'>No activity</div>}
    </ul>
  </>
}

// Shows details specific to the type of event
function ActivityDetail(props) {
  const event = props.event

  if (event.type == "dataset") {
    return <div className='event-detail'>
      <b><BsDatabase /> {event.details.name}</b>
    </div>
  } else if (event.type == "trace") {
    return <div className='event-detail'>
      <b><BsJustify /> {event.details.id}</b>
    </div>
  } else if (event.type == "annotation") {
    return <div className='event-detail'>
      In <em style={{ fontFamily: 'monospace' }}>{event.details.id}</em>
      <div className='content'>
        {event.details.content}
      </div>
    </div>
  } else {
    return null; // unknown event type
  }
}

export default Home
