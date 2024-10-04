import { BsExclamationCircle } from 'react-icons/bs';
import logo from '../assets/invariant.svg';

/**
 * Renders the result of the analysis.
**/
export function AnalysisResult(props) {
    const errors = props.errors;

    return <div className='event analysis-result'>
        <div className='content'>
            <div className="analysis-result-header">
                <img src={logo} alt='Invariant logo' className='logo' />
                <b>Invariant Analyzer</b> identified the following issues in this trace.
            </div>
            {props.errors.map((error, index) => {
                return <div className="event analysis-error" key={index}>
                    <div className="analysis-error-text">
                        <BsExclamationCircle />
                        <span className='type'>{error["type"]}</span>
                        <div className='spacer' />
                        <span className='num-matches'>Total Matches: {error["count"]}</span>
                    </div>
                </div>
            })}
        </div>
    </div>
}