export function NotFound() {
    return <div
    className='empty'
    style={{
      alignItems: 'flex-start', // Keeps text left-aligned
    }}>
    <p>
      Can't view dataset: Dataset does not exist, or you do not have permission to access this dataset.
    </p>
    <p>
      Please log in or contact the owner for access.
    </p>
  </div>
}