/**
 * Renders the result of the analysis.
**/
export function AnalysisResult(props) {
    const errors = props.errors;
    
    return <div className='event analysis-result'>
        <div className='content'>
            <div className="analysis-result-header">
                Analysis Result
            </div>
            {props.errors.map((error, index) => {
                return <div className="event analysis-error" key={index}>
                    <div className="analysis-error-text">
                        <span>{error["type"]}</span>
                        <span>Total matches: {error["count"]}</span>
                    </div>
                </div>
            })}
        </div>
    </div>
}