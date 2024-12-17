export function DatasetNotFound() {
    return <div className='empty'>
    <p>
      Can't view dataset: Dataset does not exist, or you do not have permission to access this dataset. <br />
      Please log in or contact the owner for access.
    </p>
  </div>
}
export function UserNotFound({ username }: { username: string }) {
    return (
      <div className='empty'>
        <p>
          Can't find <strong>{username}</strong>: User does not exist.
        </p>
      </div>
    );
  }
export function TraceNotFound() {
    return (
      <div className='empty'>
        <p>
        Can't view snippet: Snippet does not exist, or you do not have permission to access this snippet. <br />
        Please log in or contact the owner for access.
        </p>
      </div>
    );
  }
export function PageNotFound() {
    return <div className='empty'>
    <p>
      Page not found.
    </p>
  </div>
}