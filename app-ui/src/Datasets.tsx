import React from 'react'
import { BsFileBinaryFill, BsUpload } from 'react-icons/bs'
import { Link, useNavigate } from 'react-router-dom'
import { EntityList } from './EntityList'
import { Modal } from './Modal'
import { useUserInfo } from './UserInfo'
import { useDatasetList } from './lib/datasets'

/**
 * Creates a new dataset with the given name, with no data.
 */
function createDataset(name: string) {
  const promise = new Promise((resolve, reject) => {

    fetch('/api/v1/dataset/create', {
      method: 'POST',
      body: JSON.stringify({
        "name": name
      })
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

/**
 * Uploads a new dataset to the current user's account.
 */
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

/**
 * Modal content for uploading a new dataset.
 */
export function UploadDatasetModalContent(props) {
  const [name, setName] = React.useState('')
  const [file, setFile] = React.useState<File | null>(null)
  // indicates whether we are currently uploading the file
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  const onSubmit = () => {
    if (!name) return
    if (!file) {
      createDataset(name).then(() => {
        props.onSuccess()
        props.onClose()
      }).catch(err => {
        setError(err.detail || 'An unknown error occurred, please try again.')
      })
      return
    }
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
    <h2>Create a new trace dataset to start using the Invariant Explorer.</h2>
    <label>Name</label>
    <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Dataset Name"/>
    <label>File (optional)</label>
    <FileUploadMask file={file}/>
    <input aria-label="file-input"  type="file" onChange={e => setFile(e.target.files?.[0] || null)}/>
    <span className='description'>Before uploading a dataset, make sure it is in the correct format, as expected by the Invariant analysis engine.</span>
    <br/>
    <button aria-label='create' className='primary' disabled={!name || loading} onClick={onSubmit}>
      {loading ? 'Uploading...' : 'Create'}
    </button>
    {error && <span className='error'>{error}</span>}
  </div>
}

/**
 * Component to show a custom UI overlay for file uploads.
 * 
 * Supports drag and drop, by rendering a 0.0 opacity file <input/> on top of the custom UI.
 */
function FileUploadMask(props) {
  return <div className='file-upload-mask'>
    <div className='overlay'>
      {props.file ? <span className='selected'><BsFileBinaryFill/> {props.file.name} ({(props.file.size / 1024 / 1024).toFixed(2)} MB)
      </span> : <><BsUpload/><em>Choose a file</em> or drop it here to upload</>}
    </div>
  </div>
}

/**
 * Content to show in the modal when deleting a dataset.
 */
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
    <button aria-label='confirm delete' className='danger' disabled={loading} onClick={onDelete}>
    {loading ? 'Deleting...' : 'Delete'}
    </button>
  </div>
}


/**
 * Compact version of the dataset list (e.g. to use on the home page).
 */
export function DatasetLinkList(props) {
  const userInfo = useUserInfo()
  const datasets = props.datasets || [];
  
  const hasActions = typeof props.hasActions === 'undefined' ? true : props.hasActions
  
  return <>
    <EntityList title={null} actions={null} className={props.className}>
      {datasets.length === 0 && <div className='empty'>No datasets</div>}
      {datasets.map((dataset, i) => <Link className='item' to={`/u/${dataset.user.username}/${dataset.name}`} key={i}><li>
        <h3>{props.icon}{dataset.user.username}/{dataset.name}</h3>
      </li></Link>)}
    </EntityList>
</>
}

/**
 * List of datasets for the current user.
 */
export function Datasets() {
  // currently signed-in user info
  const userInfo = useUserInfo()
  // remote call to get the list of datasets
  const [datasets, refresh] = useDatasetList()
  // tracks whether the Upload Dataset modal is currently shown
  const [showUploadModal, setShowUploadModal] = React.useState(false)
  // tracks whether we are currently showing a delete modal for a particular dataset (null if none)
  const [selectedDatasetForDelete, setSelectedDatasetForDelete] = React.useState(null)
  
  return <>
    {/* upload modal */}
    {showUploadModal && <Modal title="Create Dataset" onClose={() => setShowUploadModal(false)} hasWindowControls>
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