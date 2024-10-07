
import { Link } from 'react-router-dom';
/**
 * A component to show when there are no traces in the dataset.
 * 
 * It contains information on how to populate the dataset with traces.
 */
export function EmptyDatasetInstructions(props) {
    return <div className='empty instructions'>
      <h3>Empty Dataset</h3>
      <p>This dataset does not contain any traces yet. To get started you can choose one of the following options.</p>
      <div className='options'>
        <div>
          <h2>Upload a Dataset</h2>
          <p>You can upload a dataset from your local machine. The dataset should be a <code>jsonl</code> file containing an array of traces.</p>
          <p>See the resources below, for more information about the trace format and how to upload a dataset.</p>
          <button className='with-arrow' onClick={() => window.location.href = 'https://github.com/invariantlabs-ai/explorer/blob/main/DOCS.md'}>
            Uploading Instructions
          </button>
        </div>
        <div>
          <h2>Add New Traces via API</h2>
          <p>You can add new traces to this dataset by pushing them directly from your application via API.</p>
          <p>For this, you need to obtain an <Link to='/settings'>API Key</Link> from the user settings and follow the instructions below.</p>
          <button className='primary with-arrow' onClick={() => window.location.href = 'https://github.com/invariantlabs-ai/explorer/blob/main/DOCS.md#push-trace-api-apiv1pushtrace'}>
            API Documentation
          </button>
          {/* <pre>
            <code>
              {push_cmd}
            </code>
          </pre> */}
        </div>
      </div>
    </div>
  }
  