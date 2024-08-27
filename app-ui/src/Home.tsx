import React, { useEffect } from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsFileBinaryFill, BsPencilFill, BsTrash, BsUpload, BsGlobe, BsDownload, BsClockHistory } from 'react-icons/bs'
import { Link, useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import { EntityList, DatasetList } from './EntityList'
import { Time } from './components/Time'
import { DeleteSnippetModal, snippetDelete, useSnippetsList } from './lib/snippets'
import { useDatasetList } from './lib/datasets'
import { DeleteDatasetModalContent, UploadDatasetModalContent } from './Datasets'

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
  const [selectedDatasetForDelete, setSelectedDatasetForDelete] = React.useState(null)
  const [selectedSnippetForDelete, setSelectedSnippetForDelete] = React.useState(null)
  const [activity, refreshActivity] = useActivity()
  const navigate = useNavigate()
  
  return <>
    {/* upload modal */}
    {showUploadModal && <Modal title="Upload Dataset" onClose={() => setShowUploadModal(false)} hasWindowControls>
      <UploadDatasetModalContent onClose={() => setShowUploadModal(false)} onSuccess={refresh}/>
    </Modal>}
    {/* delete modal */}
    {selectedDatasetForDelete && <Modal title="Delete Dataset" onClose={() => setSelectedDatasetForDelete(null)} hasWindowControls>
      <DeleteDatasetModalContent dataset={selectedDatasetForDelete} onClose={() => setSelectedDatasetForDelete(null)} onSuccess={refresh}/>
    </Modal>}
    {/* delete snippet modal */}
    {selectedSnippetForDelete && <DeleteSnippetModal snippet={selectedSnippetForDelete} setSnippet={setSelectedSnippetForDelete} onSuccess={refreshSnippets}/>}
    <DatasetList title={<Link to='/datasets'>My Datasets</Link>}
                 datasets={(datasets || []).filter((dataset) => dataset.user?.id == userInfo?.id)}
                 actions={<>
                      {userInfo?.loggedIn && <button onClick={() => setShowUploadModal(true)}>
                        <BsUpload/>
                        Upload New Dataset
                      </button>}
                    </>}
                  onDelete={(dataset) => setSelectedDatasetForDelete(dataset)}
      />
    <DatasetList title="Public Datasets" datasets={(datasets || []).filter((dataset) => dataset.is_public && dataset.user?.id != userInfo?.id)}/>
    <EntityList title={<Link to='/snippets'>Snippets</Link>}
      actions={<>
      {userInfo?.loggedIn && <button className='primary' onClick={() => navigate('/new')}>
                        <BsUpload/>
                        Upload Trace
                      </button>}
      </>}>
        {snippets.map((snippet, i) => <Link className='item' to={`/trace/${snippet.id}`} key={i}><li>
          <h3>Snippet #{i}</h3>
          <span className='description'>
            <Time>{snippet.time_created}</Time>
          </span>
          <div className='spacer'/>
          <div className='actions'>
            <button className='tool danger' onClick={(e) => { setSelectedSnippetForDelete(snippet); e.preventDefault(); e.stopPropagation(); }}><BsTrash/></button>
            <button className='primary'>View</button>
          </div>
        </li></Link>)}
        {snippets.length === 0 && <div className='empty'>No snippets</div>}
    </EntityList>
    <EntityList title="Activity">
    {activity.map((event, i) =>
    <Link className='item' to={
      {'dataset':  '/user/' + event.user.username + '/dataset/' + event.details.name,
       'trace': '/trace/' + event.details.id,
       'annotation': '/trace/' + event.details?.trace?.id
      }[event.type]
    } key={i}>
      <li className='event'>
        <div className='event-info'>
          <Link to={`/user/${event.user.username}`}>
            <div className='user'>
              <img src={"https://www.gravatar.com/avatar/" + event.user.image_url_hash} />
              <span>{event.user.username}</span>
            </div>
          </Link>
          <div className='event-time'><Time text={true}>{event.time}</Time></div>
        </div>
        <h3>{event.text +
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
        </span>
        <div className='spacer'/>
        <div className='actions'>
          <button className='primary'>View</button>
        </div>
      </li>
    </Link>
    )}
    {activity.length === 0 && <div className='empty'>No activity</div>}
    </EntityList>
  </>
}

export default Home
