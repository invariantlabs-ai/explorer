import { Base64 } from "js-base64";
import { useEffect, useRef, useState } from "react";
import React from "react";
import { BsPlayFill, BsGithub, BsShare, BsChevronLeft, BsChevronRight, BsArrowDown, BsArrowUp, BsCheckCircle, BsChevronDown, BsExclamationTriangle } from "react-icons/bs";
import { useNavigate } from "react-router-dom";
import useVerify from "../../lib/verify";

import {
  beautifyJson,
  clearTerminalControlCharacters
} from "./utils";
import type { AnalysisResult, PolicyError } from "./types";
import { TraceView } from "../../lib/traceview/traceview";
import Spinning from "./spinning";
import { PolicyEditor } from "./policyeditor";
import useWindowSize from "../../lib/size";
import './playground.scss';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable";


type PolicyViolationProps = {
  title: string;
  result: PolicyError;
};

export function PolicyViolation({ title, result}: PolicyViolationProps) {
  const handleClick = (amount: number) => {}
  const text = result.args.join(' ');

  return (
    <div className="policy-violation">
        <h2>{title}</h2>
        {/*
        <div className="policy-violation-buttons">
          {result.ranges.length > 0 && (
            <>
              <button onClick={() => handleClick(-1)}>
                <BsArrowUp />
              </button>
              <button onClick={() => handleClick(1)}>
                <BsArrowDown />
              </button>
            </>
          )}
        </div>
        */}
        <div className="text">{text}</div>
    </div>
  );
}



                        





interface PlaygroundProps {
  editable?: boolean;
  runnable?: boolean;
  deployable?: boolean;
  shareable?: boolean;
  showPolicy?: boolean;
  showTrace?: boolean;
  playgroundable?: boolean;
  headerStyle?: 'minimal' | 'full';
  resizeEditor?: boolean;
}

const Playground = ({ editable = true,
                      runnable = true,
                      deployable = true,
                      playgroundable = true,
                      shareable = true,
                      showPolicy = true,
                      showTrace = true,
                      headerStyle = 'full',
                      resizeEditor = false,
                     }: PlaygroundProps) => {
  const [policyCode, setPolicyCode] = useState<string>(
    localStorage.getItem("policy") || ""
  );
  const [inputData, setInputData] = useState<string>(
    localStorage.getItem("input") || ""
  );
  const { width: screenWidth } = useWindowSize();
  const {verify, ApiKeyModal} = useVerify();
  const navigate = useNavigate();

  const [policyEditorHeight, setPolicyEditorHeight] = useState<number | undefined>(undefined);
  
  // verification & highlight state
  const [loading, setLoading] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] = useState<PolicyError[] | null>(null);
  const [analysisResultIdx, setAnalysisResultIdx] = useState<number>(0);

  const handleBase64Hash = (hash: string) => {
    try {
      const decodedData = JSON.parse(Base64.decode(hash));
      if (decodedData.policy && decodedData.input) {
        decodedData.input = beautifyJson(decodedData.input);
        setPolicyCode(decodedData.policy);
        setInputData(decodedData.input);
        localStorage.setItem("policy", decodedData.policy);
        localStorage.setItem("input", decodedData.input);
      }
    } catch (error) {
      console.error("Failed to decode or apply hash data:", error);
    }
  };

  const handleHashChange = () => {
    const hash = window.location.hash.substring(1); // Get hash value without the '#'
    if (hash) {
      handleBase64Hash(hash);
    }
    window.history.replaceState(null, "", "");
  };

  useEffect(() => {
    // Call the handler immediately in case there's an initial hash
    handleHashChange();

    // Add the event listener for hash changes
    window.addEventListener("hashchange", handleHashChange);

    // Clean up the event listener on component unmount
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEvaluate = async () => {
    setLoading(true); // Start loading
    setAnalysisResult(null);

    try {
      // Save policy and input to localStorage
      localStorage.setItem("policy", policyCode);
      localStorage.setItem("input", inputData);

      // Analyze the policy with the input data
      const analyzeResponse = await verify(JSON.parse(inputData), policyCode);
      if (analyzeResponse.status !== 200) {
        analyzeResponse.json().then((text) => {
          setLoading(false);
        });
        throw new Error(analyzeResponse.statusText);
      }

      const analysisResult: string | AnalysisResult =
        await analyzeResponse.json();

      // check for error messages
      if (typeof analysisResult === "string") {
        setLoading(false);
        return;
      }
      
      setAnalysisResult(analysisResult.errors);
      setAnalysisResultIdx(0);
    } catch (error) {
      console.error("Failed to evaluate policy:", error);
    } finally {
      setLoading(false); // End loading
    }
  };

  const getShareURL = () => {
    const data = JSON.stringify({ policy: policyCode, input: inputData });
    const encodedData = Base64.encode(data);
    return `${window.location.origin}${window.location.pathname.replace('/embed','')}#${encodedData}`;
  }

  const handleInputChange = (value: string | undefined) => {
    if (value !== undefined) {
      const beautified = beautifyJson(value);
      setInputData(beautified);
      localStorage.setItem("input", beautified);
    }
  };

  const handleShare = () => {
    navigator.clipboard
      .writeText(getShareURL())
      .then(() => {
        alert("URL copied to clipboard!");
      })
      .catch((error) => {
        alert("Uh oh! Something went wrong.");
      });
  };

  const handleOpenInPlayground = () => {
    window.open(getShareURL(), '_blank');
  };
  
  const handleDeploy = () => {
    const location = '/deploy-guardrail#policy-code=' + encodeURIComponent(policyCode) + '&name=' + 'New Rule'
    window.open(location, '_blank');
  }

  return (
    <>
    <ApiKeyModal />
    <div className="playground">
        <h2 className={`header-${headerStyle}`}>
        {headerStyle === 'full' &&
          <div className="playground-title">Guardrail</div>
        }

        {deployable && (
          <button className="playground-button" onClick={handleDeploy}>Deploy</button>)
        }

        {shareable && (
          <button onClick={handleShare} className="playground-button" >Share</button>)
        }

        {playgroundable && (
          <button onClick={handleOpenInPlayground} className="playground-button" >Open in Playground</button>)
        }

        {runnable && (
          <button onClick={handleEvaluate} disabled={loading} className="playground-button" >
            <span style={{whiteSpace: 'nowrap'}}> {loading ? ( <Spinning />) : ( <BsPlayFill className="icon-play" />)}Evaluate</span>
          </button>)
        }
        </h2>
        
        <ResizablePanelGroup 
          direction="horizontal" 
          className="playground-container"
        >
          {showPolicy && (
            <>
              <ResizablePanel 
                defaultSize={50} 
                minSize={25}
                className="panel" 
                style={(resizeEditor && policyEditorHeight) ? { height: `${policyEditorHeight}px` } : undefined}
              >
                <PolicyEditor
                  height="100%"
                  defaultLanguage="python"
                  value={policyCode}
                  readOnly={!editable}
                  onChange={(value?: string) => setPolicyCode(value || "")}
                  theme="vs-light"
                  onDidContentSizeChange={(size) => {
                    if (resizeEditor) setPolicyEditorHeight(size.contentHeight);
                  }}
                />
              </ResizablePanel>
              
              {showTrace && <ResizableHandle/>}
            </>
          )}
          
             {showTrace && (
                <>
                  <ResizablePanel defaultSize={50} minSize={25} className="panel-horizontal">
                      {analysisResult&& Object.keys(analysisResult).length == 0 && (
                        <div>No matches found.</div>
                      )}
                      {analysisResult && Object.keys(analysisResult).length > 0 && (
                        <>
                        <div style={{ textAlign: 'right' }}>
                          {analysisResultIdx + 1} / {analysisResult.length}
                        <div className="controls">
                          <button onClick={() => {setAnalysisResultIdx( (analysisResultIdx - 1) % analysisResult.length )}}>
                            <BsChevronLeft />
                          </button>
                          <button onClick={() => {setAnalysisResultIdx( (analysisResultIdx + 1) % analysisResult.length )}}>
                            <BsChevronRight />
                          </button>
                        </div>
                        </div>
                        <PolicyViolation title={`Match #${analysisResultIdx + 1}`} result={analysisResult[analysisResultIdx]} />
                        </>
                      )}
                      <TraceView
                        inputData={inputData}
                        traceId={'<none>'}
                        handleInputChange={handleInputChange}
                        highlights={analysisResult && analysisResult[analysisResultIdx] ? Object.fromEntries(analysisResult[analysisResultIdx].ranges.map(r => [r, r])) : {}}
                        sideBySide={false}
                        editor={true}
                      />
                  </ResizablePanel>
                </>
              )}
        </ResizablePanelGroup>
    </div>
    </>
  );
};


export default Playground;
