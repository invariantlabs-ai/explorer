import React from 'react'
import { Modal } from '../Modal'
import { sharedFetch } from '../SharedFetch'
import { useUserInfo } from '../UserInfo'
import { traceDelete } from './traces'

export function DeleteSnippetModalContent(props: { snippet: any, onClose: () => void, onSuccess?: () => void, entityName: string }) {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  const id = props.snippet.id

  const onDelete = () => {
    setLoading(true)
    traceDelete(id).then(response => {
      if (response.ok) {
        setLoading(false);
        if (props.onSuccess) props.onSuccess()
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
    <h2>Are you sure you want to delete this {props.entityName}?<br /><br />
      Note that this action is irreversible. All associated data and annotations will be lost.</h2>
    {error ? <span className='error'>{error}</span> : <br />}
    <button className='danger' disabled={loading} onClick={onDelete}>
      {loading ? 'Deleting...' : 'Delete'}
    </button>
  </div>
}

export function DeleteSnippetModal(props: { snippet: any, setSnippet: (snippet: any) => void, onSuccess?: () => void, entityName?: string }) {
  const capitalized = (props.entityName || "snippet").charAt(0).toUpperCase() + (props.entityName || "snippet").slice(1)
  return <Modal title={"Delete " + capitalized} onClose={() => props.setSnippet(null)} hasWindowControls>
    <DeleteSnippetModalContent snippet={props.snippet} onClose={() => props.setSnippet(null)} onSuccess={props.onSuccess} entityName={props.entityName || 'snippet'} />
  </Modal>
}

export function useSnippetsList(limit: number | null = null): [any[], () => void] {
  const [snippets, setSnippets] = React.useState<any[]>([])
  const userInfo = useUserInfo()

  const refresh = () => {
    sharedFetch('/api/v1/trace/snippets?limit=' + (limit || '')).then(response => {
      setSnippets(response)
    }).catch(() => {
        setSnippets([])
        alert('Failed to fetch user snippets')
    })
  }

  React.useEffect(() => {
    if (userInfo?.loggedIn) {
      refresh()
    }
  }, [userInfo])

  return [
    snippets,
    refresh
  ]
}