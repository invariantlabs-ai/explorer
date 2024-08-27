import React, { useEffect } from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsFileBinaryFill, BsPencilFill, BsTrash, BsUpload, BsGlobe, BsDownload, BsClockHistory } from 'react-icons/bs'
import { Link, useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import { EntityList, DatasetList } from './EntityList'


function uploadDataset(name: string, file: File) {
  const promise = new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('name', name)
    formData.append('file', file)

    fetch('/api/v1/dataset/upload', {
      method: 'POST',
      body: formData
    }).then(response => {
      if (response.ok) {
        resolve({success: true})
      } else {
        response.json().then(data => {
          reject(data)
        }).catch(() => {
          reject({"error": "Unknown error"})
        })
      }
    }).catch(() => {
      reject({"error": "Network error"})
    })
  })
  
  return promise
}

function UploadDatasetModalContent(props) {
  const [name, setName] = React.useState('')
  const [file, setFile] = React.useState<File | null>(null)
  // indicates whether we are currently uploading the file
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  const onSubmit = () => {
    if (!name || !file) return
    setLoading(true)
    uploadDataset(name, file).then(() => {
      // on success, close the modal
      setLoading(false)
      props.onSuccess()
      props.onClose()
    }).catch(err => {
      setLoading(false)
      setError(err.detail || 'An unknown error occurred, please try again.')
    })
  }

  // on file selection, derive name from file name if not already set
  React.useEffect(() => {
    if (!name && file) {
      let name = file.name
      if (name.endsWith('.json')) {
        name = name.slice(0, -5)
      } else if (name.endsWith('.jsonl')) {
        name = name.slice(0, -6)
      }
      setName(name)
    }
  }, [file])
  
  return <div className='form'>
    <h2>Upload a new trace dataset to start using the Invariant Explorer.</h2>
    <label>Name</label>
    <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Dataset Name"/>
    <label>File</label>
    <FileUploadMask file={file}/>
    <input type="file" onChange={e => setFile(e.target.files?.[0] || null)}/>
    <span className='description'>Before uploading a dataset, make sure it is in the correct format, as expected by the Invariant analysis engine.</span>
    <br/>
    <button className='primary' disabled={!name || !file || loading} onClick={onSubmit}>
      {loading ? 'Uploading...' : 'Upload'}
    </button>
    {error && <span className='error'>{error}</span>}
  </div>
}

function FileUploadMask(props) {
  return <div className='file-upload-mask'>
    <div className='overlay'>
      {props.file ? <span className='selected'><BsFileBinaryFill/> {props.file.name} ({(props.file.size / 1024 / 1024).toFixed(2)} MB)
      </span> : <><BsUpload/><em>Choose a file</em> or drop it here to upload</>}
    </div>
  </div>
}

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



function useDatasetList(): [any[], () => void] {
  const [datasets, setDatasets] = React.useState<any[]>([])

  const refresh = () => {
    fetch('/api/v1/dataset/list').then(response => {
      if (response.ok) {
        response.json().then(data => {
          setDatasets(data)
        })
      }
    })
  }

  React.useEffect(() => refresh(), [])

  return [
    datasets,
    refresh
  ]
}

function useSnippetsList(): [any[], () => void] {
  const [snippets, setSnippets] = React.useState<any[]>([])
  const userInfo = useUserInfo()

  const refresh = () => {
    if (userInfo?.loggedIn) {
      fetch('/api/v1/trace/snippets').then(response => {
        if (response.ok) {
          response.json().then(data => {
            setSnippets(data)
          })
        } else {
          setSnippets([])
          alert('Failed to fetch user snippets')
        }
      })
    }
  }

  React.useEffect(() => refresh(), [])

  return [
    snippets,
    refresh
  ]
}

function DeleteDatasetModalContent(props) {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  const id = props.dataset.id

  const onDelete = () => {
    setLoading(true)
    fetch(`/api/v1/dataset/${id}`, {
      method: 'DELETE'
    }).then(response => {
      if (response.ok) {
        setLoading(false)
        props.onSuccess()
        props.onClose()
      } else {
        response.json().then(data => {
          setLoading(false)
          setError(data.detail || 'An unknown error occurred, please try again.')
        }).catch(() => {
          setLoading(false)
          setError('An unknown error occurred, please try again.')
        })
      }
    })
  }

  return <div className='form'>
    <h2>Are you sure you want to delete {props.dataset.name}?<br/><br/>
    Note that this action is irreversible. All associated data will be lost.</h2>
    {error ? <span className='error'>{error}</span> : <br/>}
    <button className='danger' disabled={loading} onClick={onDelete}>
    {loading ? 'Deleting...' : 'Delete'}
    </button>
  </div>
}

function Home() {
  const userInfo = useUserInfo()
  
  const [datasets, refresh] = useDatasetList()
  const [snippets, refreshSnippets] = useSnippetsList() 
  const [showUploadModal, setShowUploadModal] = React.useState(false)
  const [selectedDatasetForDelete, setSelectedDatasetForDelete] = React.useState(null)
  const [activity, refreshActivity] = useActivity()
  const navigate = useNavigate()
  
  const timeAgo = (timestamp) => {
    const now = new Date()
    const diff = now.getTime() - new Date(timestamp).getTime()
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    const months = Math.floor(days / 30)
    const years = Math.floor(months / 12)
    if (years > 0) {
      return `${years} years ago`
    } else if (months > 0) {
      return `${months} months ago`
    } else if (days > 0) {
      return `${days} days ago`
    } else if (hours > 0) {
      return `${hours} hours ago`
    } else if (minutes > 0) {
      return `${minutes} minutes ago`
    } else {
      return `${seconds} seconds ago`
    }
  }

  
  return <>
    {/* upload modal */}
    {showUploadModal && <Modal title="Upload Dataset" onClose={() => setShowUploadModal(false)} hasWindowControls>
      <UploadDatasetModalContent onClose={() => setShowUploadModal(false)} onSuccess={refresh}/>
    </Modal>}
    {/* delete modal */}
    {selectedDatasetForDelete && <Modal title="Delete Dataset" onClose={() => setSelectedDatasetForDelete(null)} hasWindowControls>
      <DeleteDatasetModalContent dataset={selectedDatasetForDelete} onClose={() => setSelectedDatasetForDelete(null)} onSuccess={refresh}/>
    </Modal>}
    { userInfo?.loggedIn &&
    <DatasetList title="My Datasets" datasets={(datasets || []).filter((dataset) => dataset.user?.id == userInfo?.id)}
                 actions={<>
                      {<button onClick={() => setShowUploadModal(true)}>
                        <BsUpload/>
                        Upload New Dataset
                      </button>}
                      {<button className='primary' onClick={() => navigate('/new')}>
                        <BsUpload/>
                        Upload Trace
                      </button>}
                    </>}
                  onDelete={(dataset) => setSelectedDatasetForDelete(dataset)}
      />
    }
    <DatasetList title="Public Datasets" datasets={(datasets || []).filter((dataset) => dataset.is_public && dataset.user?.id != userInfo?.id)}/>
    { userInfo?.loggedIn && <EntityList title="Snippets">
        {snippets.map((snippet, i) => <Link className='item' to={`/trace/${snippet.id}`} key={i}><li>
          <h3>{snippet.name}</h3>
          <span className='description'>Snippet #{i}</span>
          <div className='spacer'/>
          <div className='actions'>
            <button className='primary'>View</button>
          </div>
        </li></Link>)}
    </EntityList>}
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
          <div className='event-time'>{timeAgo(event.time)}</div>
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
    </EntityList>
  </>
}

export default Home
