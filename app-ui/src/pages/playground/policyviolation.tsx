import { useEffect, useState } from "react";
import { BsArrowDown, BsArrowUp, BsCheckCircle, BsChevronDown, BsChevronRight,BsExclamationTriangle } from "react-icons/bs";

import type { PolicyError } from "./types";

type PolicyViolationProps = {
  title: string;
  result: PolicyError;
  ranges: Record<string, number>;
  setScroll: (position: "top" | number, path?: string) => void;
};

export function PolicyViolation({ title, result, ranges, setScroll }: PolicyViolationProps) {
  const [counter, setCounter] = useState(result.ranges.length - 1);
  const [clicked, setClicked] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const handleClick = (amount: number) => {
    const len = result.ranges.length;
    if (len === 0) return;
    if (len === 1) {
      setScroll(ranges[result.ranges[0]], result.ranges[0]);
      return;
    }
    setCounter((counter + amount + len) % len);
    setClicked(true);
  };

  useEffect(() => {
    if (!clicked) return;
    setScroll(ranges[result.ranges[counter]], result.ranges[counter]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counter, clicked]);

  const text = result.error;

  const toggleAccordion = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="bg-white p-4 rounded-lg border-solid border-[1px] border-border-color m-[10px]" style={{ width: "calc(100% - 20px)" }}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[16px] flex items-center select-none text-black/[0.59]">
          {title === "Policy Violation" ? <BsExclamationTriangle className="mr-2" /> : <BsCheckCircle className="mr-2" />}
          {title}
        </h2>
        <div className="flex items-center">
          {result.ranges.length > 0 && (
            <>
              <button onClick={() => handleClick(-1)} className="px-2 py-1 text-xs font-bold text-indigo-500 bg-indigo-100 rounded-l-full hover:bg-indigo-200">
                <BsArrowUp />
              </button>
              <button onClick={() => handleClick(1)} className="px-2 py-1 text-xs font-bold text-indigo-500 bg-indigo-100 rounded-r-full hover:bg-indigo-200">
                <BsArrowDown />
              </button>
              <span className="inline-flex items-center justify-center px-2 py-1 ml-2 text-xs font-bold leading-none text-red-100 bg-indigo-500 rounded-full min-w-[40px]">
                {(counter % result.ranges.length) + 1}/{result.ranges.length}
              </span>
            </>
          )}
          <button onClick={toggleAccordion} className="ml-2 text-indigo-500">
            {isExpanded ? <BsChevronDown /> : <BsChevronRight />}
          </button>
        </div>
      </div>
      {isExpanded && (
        <div className="mt-2 text-sm text-foreground bg-gray-50 p-3 rounded-lg overflow-auto cursor-text">{text}</div>
      )}
    </div>
  );
}