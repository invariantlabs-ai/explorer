import { Base64 } from "js-base64";
import { useEffect, useRef, useState } from "react";
import React from "react";
import { BsPlayFill, BsGithub, BsShare } from "react-icons/bs";
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
import { PolicyViolation } from "./policyviolation";
import useWindowSize from "../../lib/size";
import './playground.scss';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./resizable";

interface PlaygroundProps {
  editable?: boolean;
  runnable?: boolean;
  deployable?: boolean;
  shareable?: boolean;
  showPolicy?: boolean;
  showTrace?: boolean;
  showOutput?: boolean;
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
                      showOutput = true,
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

  // output and ranges
  const [loading, setLoading] = useState<boolean>(false);
  const [output, setOutput] = useState<string | AnalysisResult>("");
  const [ranges, setRanges] = useState<Record<string, string>>({});
  const [checkingTime, setCheckingTime] = useState<number>(0);
  const [policyEditorHeight, setPolicyEditorHeight] = useState<number | undefined>(undefined);

  const handleBase64Hash = (hash: string) => {
    try {
      const decodedData = JSON.parse(Base64.decode(hash));
      if (decodedData.policy && decodedData.input) {
        decodedData.input = beautifyJson(decodedData.input);
        setPolicyCode(decodedData.policy);
        setInputData(decodedData.input);
        setOutput("");
        setRanges({});
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
    //window.history.replaceState(null, "", " ");
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

  const setScroll = function (position: "top" | number, path?: string) {
    //if (traceViewRef.current) traceViewRef.current.setScroll(position, path);
  };

  const handleEvaluate = async () => {
    setLoading(true); // Start loading
    setOutput(""); // Clear previous output
    setRanges({}); // Clear previous ranges
    setScroll("top");

    try {
      // Save policy and input to localStorage
      localStorage.setItem("policy", policyCode);
      localStorage.setItem("input", inputData);

      // Analyze the policy with the input data
      const analyzeResponse = await verify(JSON.parse(inputData), policyCode);
      if (analyzeResponse.status !== 200) {
        analyzeResponse.json().then((text) => {
          console.log(text)
          setOutput(clearTerminalControlCharacters(text.detail || text));
          //setOutput(clearTerminalControlCharacters(text.detail || text));
          setRanges({});
          setLoading(false);
        });
        throw new Error(analyzeResponse.statusText);
      }

      const analysisResult: string | AnalysisResult =
        await analyzeResponse.json();

      // check for error messages
      if (typeof analysisResult === "string") {
        setOutput(clearTerminalControlCharacters(analysisResult));
        setRanges({});
        setLoading(false);
        return;
      }

      // get X-Invariant-Checking-Time
      const invariantTime = analyzeResponse.headers.get(
        "x-invariant-checking-time"
      );
      if (invariantTime) {
        const time = parseInt(invariantTime, 10);
        setCheckingTime(time);
      }

      const annotations: Record<string, string> = {};
      analysisResult.errors.forEach((e: PolicyError) => {
        // store the error message as the concatenation of all args
        e.error = e.args
          .map((a) =>
            typeof a === "object" ? JSON.stringify(a) : a.toString()
          )
          .join(" ");
        // store this error message for each range as an annotation
        e.ranges.forEach((r: string) => {
          annotations[r] = e.args.map((a) => a.toString()).join(" ");
        });
      });
      console.log(annotations);
      setRanges(annotations);
      //setOutput(JSON.stringify(analysisResult, null, 2));
      setOutput(analysisResult);
    } catch (error) {
      console.error("Failed to evaluate policy:", error);
      setRanges({});
      setOutput(
        "An error occurred during evaluation: " + (error as Error).message
      );
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
        console.log(error)
      });
  };

  const handleOpenInPlayground = () => {
    window.open(getShareURL(), '_blank');
  };

  return (
    <>
    <ApiKeyModal />
    <div className="playground">
        <h2 className={`header-${headerStyle}`}>
        {headerStyle === 'full' &&
          <div className="playground-title">Guardrail</div>
        }

        {deployable && (
          <>
          <button 
            className="playground-button"
          >
            Deploy
          </button>
          </>)
        }


        {shareable && (
          <>
          <button 
            onClick={handleShare} 
            className="playground-button"
          >
            Share
          </button>
          </>)
        }

        {playgroundable && (
          <>
          <button 
            onClick={handleOpenInPlayground} 
            className="playground-button"
          >
            Open in Playground
          </button>
          </>)
        }


        {runnable && (
          <>
          <button 
            onClick={handleEvaluate} 
            disabled={loading}
            className="playground-button"
          >
          <span style={{whiteSpace: 'nowrap'}}>
            {loading ? (
              <Spinning />
            ) : (
              <BsPlayFill className="icon-play" />
            )}
            Evaluate
          </span>
          </button>
          </>)
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
                    <TraceView
                      inputData={inputData}
                      traceId={'<none>'}
                      handleInputChange={handleInputChange}
                      highlights={{}}
                      header={false}
                      sideBySide={false}
                    />
                  </ResizablePanel>
                </>
              )}

              {showOutput && false && (
                <ResizablePanel defaultSize={showTrace ? 50 : 100} className="panel-horizontal">
                  <div className="output-container">
                    <div className="output-header">
                      Output
                      {checkingTime > 0 && (
                        <span className="output-time">
                          {checkingTime} ms
                        </span>
                      )}
                    </div>
                    <div className="output-content">
                      {loading ? (
                        <div className="spinner-container">
                          <Spinning />
                        </div>
                      ) : (
                        <div className="output-text">
                          {typeof output === "string" ? (
                            output
                          ) : output.errors.length > 0 ? (
                            output.errors.reduce(
                              (
                                acc: {
                                  currentIndex: number;
                                  ranges: Record<string, number>;
                                  components: React.ReactElement[];
                                },
                                result,
                                key
                              ) => {
                                for (const range of result.ranges) {
                                  if (acc.ranges[range] === undefined) {
                                    acc.ranges[range] = acc.currentIndex;
                                    acc.currentIndex++;
                                  }
                                }
                                acc.components.push(
                                  <React.Fragment key={key}>
                                    <PolicyViolation
                                      title={"Policy Violation"}
                                      result={result}
                                      ranges={acc.ranges}
                                      setScroll={setScroll}
                                    />
                                  </React.Fragment>
                                );
                                return acc;
                              },
                              { currentIndex: 0, components: [], ranges: {} }
                            ).components
                          ) : (
                            <PolicyViolation
                              title={"OK"}
                              result={{
                                error: "No policy violations were detected",
                                ranges: [],
                              }}
                              ranges={{}}
                              setScroll={() => {}}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </ResizablePanel>
              )}
        </ResizablePanelGroup>
    </div>
    </>
  );
};


export default Playground;
