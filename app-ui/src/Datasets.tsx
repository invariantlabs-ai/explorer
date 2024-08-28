import React from 'react'
import { BsFileBinaryFill, BsUpload } from 'react-icons/bs'
import { Link, useNavigate } from 'react-router-dom'
import { EntityList } from './EntityList'
import { Modal } from './Modal'
import { useUserInfo } from './UserInfo'
import { useDatasetList } from './lib/datasets'


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

export function UploadDatasetModalContent(props) {
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

export function DeleteDatasetModalContent(props) {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  const id = props.dataset.id

  const onDelete = () => {
    setLoading(true)
    fetch(`/api/v1/dataset/byid/${id}`, {
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


export function DatasetLinkList(props) {
  const userInfo = useUserInfo()
  const datasets = props.datasets || [];
  
  const hasActions = typeof props.hasActions === 'undefined' ? true : props.hasActions
  
  return <>
    <EntityList title={null} actions={null} className={props.className}>
      {datasets.length === 0 && <div className='empty'>No datasets</div>}
      {datasets.map((dataset, i) => <Link className='item' to={`/user/${dataset.user.username}/dataset/${dataset.name}`} key={i}><li>
        <h3>{props.icon}{dataset.user.username}/{dataset.name}</h3>
      </li></Link>)}
    </EntityList>
</>
}

export function Datasets() {
  const userInfo = useUserInfo()
  
  const [datasets, refresh] = useDatasetList()
  const [showUploadModal, setShowUploadModal] = React.useState(false)
  const [selectedDatasetForDelete, setSelectedDatasetForDelete] = React.useState(null)
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
    <EntityList title="Datasets" actions={<>
                      {userInfo?.loggedIn && <button onClick={() => setShowUploadModal(true)}><BsUpload/> Upload New Dataset</button>}
                    </>}>
    <DatasetLinkList title="My Datasets" datasets={(datasets || []).filter((dataset) => dataset.user?.id == userInfo?.id)} onDelete={setSelectedDatasetForDelete}/>
      </EntityList>
  </>
}