import React, { useEffect } from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsFileBinaryFill, BsPencilFill, BsTrash, BsUpload, BsGlobe, BsDownload, BsClockHistory } from 'react-icons/bs'
import { Link, useNavigate } from 'react-router-dom'
import { Modal } from './Modal'

function EntityList(props) {
  return <div className="panel entity-list">
    <header>
      <h1>{props.title}</h1>
      <div className="spacer"/>
      <div className="actions">
        {props.actions}
      </div>
    </header>
    <ul>
      {props.children}
    </ul>
  </div>
}

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

  const refresh = () => {
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
  const [downloadState, setDownloadState] = React.useState({})
  
  const navigate = useNavigate()
  
  useEffect(() => {
    let state = downloadState || {}
    for (const dataset of datasets) {
      if (state[dataset.id] === undefined) {
        state[dataset.id] = 'ready'
      }
    }
    setDownloadState(state)
  }, [userInfo, datasets])
  
  const onDownloadDataset = (dataset) => {
    return (event) => {
      if (downloadState[dataset.id] ==='ready') {
        setDownloadState({...downloadState, [dataset.id]: 'waiting'})
        fetch('/api/v1/dataset/full/'+dataset.id).then(response => {
          if (!response.ok) {
            throw new Error('could net fetch dataset')
          }
          return response.json()}).then(data => {
            const link = document.createElement('a')
            var out = ''
            data.traces.forEach(trace => {
              out += JSON.stringify(trace) + '\n'
            })
            link.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(out)
            link.setAttribute('download', dataset.name + '.jsonl')
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            setDownloadState({...downloadState, [dataset.id]: 'ready'})
        }).catch(err => {
          setDownloadState({...downloadState, [dataset.id]:'ready'})
          alert('Could not download the dataset.')
        })
      }
      event.preventDefault()
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
    <EntityList title="My Datasets" actions={<>
      {userInfo?.loggedIn && <button onClick={() => setShowUploadModal(true)}>
        <BsUpload/>
        Upload New Dataset
      </button>}
      {userInfo?.loggedIn && <button className='primary' onClick={() => navigate('/new')}>
        <BsUpload/>
        Upload Trace
      </button>}
    </>}>
      {(datasets || []).filter((dataset) => dataset.user?.id == userInfo?.id).map((dataset, i) => <Link className='item' to={`/dataset/${dataset.id}`} key={i}><li>
        <h3>{dataset.name}</h3>
        {dataset.is_public && <span className='description'><BsGlobe/></span>}
        <span className='description'>
          {dataset.extra_metadata}
        </span>
        <div className='spacer'/>
        <div className='actions'>
          {/* <button>
            <BsPencilFill/> Edit
          </button> */}
          <button className='tool' onClick={onDownloadDataset(dataset)}>
            {downloadState[dataset.id] == 'ready' && <BsDownload/>}
            {downloadState[dataset.id] == 'waiting' && <BsClockHistory/>}
            {downloadState[dataset.id] != 'ready' && downloadState[dataset.id] != 'waiting' && <BsDownload/>}
          </button>
          <button className='tool danger' onClick={(e) => {
            e.preventDefault()
            setSelectedDatasetForDelete(dataset)
          }}><BsTrash/></button>
          <button className='primary'>View</button>
        </div>
      </li></Link>)}
    </EntityList>
    <EntityList title="Public Datasets">
      {(datasets || []).filter((dataset) => dataset.is_public && dataset.user?.id != userInfo?.id)
      .map((dataset, i) => <Link className='item' to={`/dataset/${dataset.id}`} key={i}><li>
        <h3>{dataset.user.username}/{dataset.name}</h3>
        <span className='description'>
          {dataset.extra_metadata}
        </span>
        <div className='spacer'/>
        <div className='actions'>
          {/* <button>
            <BsPencilFill/> Edit
          </button> */}
          <button className='tool' onClick={onDownloadDataset(dataset)}>
            {downloadState[dataset.id] == 'ready' && <BsDownload/>}
            {downloadState[dataset.id] == 'waiting' && <BsClockHistory/>}
            {downloadState[dataset.id] != 'ready' && downloadState[dataset.id] != 'waiting' && <BsDownload/>}
          </button>
          {dataset.user.username == userInfo?.username && <button className='tool danger' onClick={(e) => {
            e.preventDefault()
            setSelectedDatasetForDelete(dataset)
          }}><BsTrash/></button>}
          <button className='primary'>View</button>
        </div>
      </li></Link>)}
    </EntityList>
    <EntityList title="Snippets">
        {snippets.map((snippet, i) => <Link className='item' to={`/trace/${snippet.id}`} key={i}><li>
          <h3>{snippet.name}</h3>
          <span className='description'>Snippet #{i}</span>
          <div className='spacer'/>
          <div className='actions'>
            <button className='primary'>View</button>
          </div>
        </li></Link>)}
    </EntityList>

  </>
}

export default Home
