import React, { useEffect } from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsFileBinaryFill, BsPencilFill, BsTrash, BsUpload, BsGlobe, BsDownload, BsClockHistory, BsDatabase, BsCode, BsJustify } from 'react-icons/bs'
import { Link, useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import { EntityList } from './EntityList'
import { Time } from './components/Time'
import { DeleteSnippetModal, snippetDelete, useSnippetsList } from './lib/snippets'
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
  
  const [datasets, refresh] = useDatasetList()
  const [snippets, refreshSnippets] = useSnippetsList() 
  const [showUploadModal, setShowUploadModal] = React.useState(false)
  const [selectedSnippetForDelete, setSelectedSnippetForDelete] = React.useState(null)
  const [activity, refreshActivity] = useActivity()
  const navigate = useNavigate()
  
  // return <>
  //   {/* upload modal */}
  //   {showUploadModal && <Modal title="Upload Dataset" onClose={() => setShowUploadModal(false)} hasWindowControls>
  //     <UploadDatasetModalContent onClose={() => setShowUploadModal(false)} onSuccess={refresh}/>
  //   </Modal>}
  //   {/* delete modal */}
  //   {selectedDatasetForDelete && <Modal title="Delete Dataset" onClose={() => setSelectedDatasetForDelete(null)} hasWindowControls>
  //     <DeleteDatasetModalContent dataset={selectedDatasetForDelete} onClose={() => setSelectedDatasetForDelete(null)} onSuccess={refresh}/>
  //   </Modal>}

  //   { userInfo?.loggedIn &&
  //   <DatasetList title="My Datasets" datasets={(datasets || []).filter((dataset) => dataset.user?.id == userInfo?.id)}
  //                actions={<>
  //                     {<button onClick={() => setShowUploadModal(true)}>
  //                       <BsUpload/>
  //                       Upload New Dataset
  //                     </button>}

  //                     {<button className='primary' onClick={() => navigate('/new')}>
  //                       <BsUpload/>
  //                       Upload Trace
  //                     </button>}
  //                   </>}
  //                 onDelete={(dataset) => setSelectedDatasetForDelete(dataset)}
  //     />
  //   }
  //   <DatasetList title="Public Datasets" datasets={(datasets || []).filter((dataset) => dataset.is_public && dataset.user?.id != userInfo?.id)}/>
  //   { userInfo?.loggedIn && <EntityList title="Snippets">
  //       {snippets.map((snippet, i) => <Link className='item' to={`/trace/${snippet.id}`} key={i}><li>
  //         <h3>Snippet #{i}</h3>
  //         <span className='description'>
  //           <Time>{snippet.time_created}</Time>
  //         </span>
  //         <div className='spacer'/>
  //         <div className='actions'>
  //           <button className='tool danger' onClick={(e) => { setSelectedSnippetForDelete(snippet); e.preventDefault(); e.stopPropagation(); }}><BsTrash/></button>
  //           <button className='primary'>View</button>
  //         </div>
  //       </li></Link>)}
  //       {snippets.length === 0 && <div className='empty'>No snippets</div>}
  //   </EntityList>}
  //   <EntityList title="Activity">
  //   {activity.map((event, i) =>
  //   <Link className='item' to={
  //     {'dataset':  '/user/' + event.user.username + '/dataset/' + event.details.name,
  //      'trace': '/trace/' + event.details.id,
  //      'annotation': '/trace/' + event.details?.trace?.id
  //     }[event.type]
  //   } key={i}>
  //     <li className='event'>
  //       <div className='event-info'>
  //         <Link to={`/user/${event.user.username}`}>
  //           <div className='user'>
  //             <img src={"https://www.gravatar.com/avatar/" + event.user.image_url_hash} />
  //             <span>{event.user.username}</span>
  //           </div>
  //         </Link>
  //         <div className='event-time'><Time text={true}>{event.time}</Time></div>
  //       </div>
  //       <h3>{event.text +
  //            {'dataset': ': ' + event.details.name,
  //             'trace': '',
  //             'annotation': ''
  //            }[event.type]}</h3>
  //       <span className='description'>
  //       {
  //            {'dataset': ' ' + event.details.extra_metadata,
  //             'trace': event.details.extra_metadata,
  //             'annotation': event.details.content
  //            }[event.type]
  //       }
  //       </span>
  //       <div className='spacer'/>
  //       <div className='actions'>
  //         <button className='primary'>View</button>
  //       </div>
  //     </li>
  //   </Link>
  //   )}
  //   {activity.length === 0 && <div className='empty'>No activity</div>}
  //   </EntityList>
  // </>

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
        <CompactSnippetList icon={<BsJustify />} snippets={snippets} />
      </div>
    </div>}
    {/* public datastes */}
    <div className='box'>
      <h2>Public Datasets</h2>
      <DatasetLinkList datasets={datasets.filter(dataset => dataset.is_public)} icon={<BsGlobe />} />
    </div>
    <ul className='box activity'>
      <h2>Activity</h2>
      {activity.map((event, i) =>
      <Link className='item' to={
        {'dataset':  '/user/' + event.user.username + '/dataset/' + event.details.name,
        'trace': '/trace/' + event.details.id,
        'annotation': '/trace/' + event.details?.trace?.id
        }[event.type]
      } key={i}>
        <li className='event'>
          <div className='event-info'>
            <div className='user'>
              <img src={"https://www.gravatar.com/avatar/" + event.user.image_url_hash} />
              <div className='left'>
                <div><Link to={`/user/${event.user.username}`}><b>{event.user.username}</b></Link> {event.text}</div>
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
      </Link>
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
