import React, { useEffect } from 'react'
import {UserInfo, useUserInfo} from './UserInfo'
import { BsFileBinaryFill, BsPencilFill, BsTrash, BsUpload } from 'react-icons/bs'
import { Link } from 'react-router-dom'
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

function DeleteDatasetModalContent(props) {
  const [loading, setLoading] = React.useState(false)

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
      }
    })
  }

  return <div className='form'>
    <h2>Are you sure you want to delete {props.dataset.name}?<br/><br/>
    Note that this action is irreversible. All associated data will be lost.</h2>
    <br/>
    <button className='danger' disabled={loading} onClick={onDelete}>
    {loading ? 'Deleting...' : 'Delete'}
    </button>
  </div>
}

function Home() {
  const [datasets, refresh] = useDatasetList()
  const [showUploadModal, setShowUploadModal] = React.useState(false)
  const [selectedDatasetForDelete, setSelectedDatasetForDelete] = React.useState(null)
  const userInfo = useUserInfo()
  
  useEffect(() => {
    console.log((datasets || []))
    console.log((datasets || []).map((dataset) => dataset.user?.id == userInfo?.id))

  }, [userInfo, datasets])


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
      <button className='primary' onClick={() => setShowUploadModal(true)}>
        <BsUpload/>
        Upload New Dataset
      </button>
    </>}>
      {(datasets || []).filter((dataset) => dataset.user?.id == userInfo?.id).map((dataset, i) => <Link className='item' to={`/dataset/${dataset.id}`} key={i}><li>
        <h3>{dataset.name}</h3>
        <span className='description'>
          {dataset.extra_metadata}
        </span>
        <div className='spacer'/>
        <div className='actions'>
          {/* <button>
            <BsPencilFill/> Edit
          </button> */}
          <button className='danger' onClick={(e) => {
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
          <button className='danger' onClick={(e) => {
            e.preventDefault()
            setSelectedDatasetForDelete(dataset)
          }}><BsTrash/></button>
          <button className='primary'>View</button>
        </div>
      </li></Link>)}
    </EntityList>

  </>
}

export default Home
