import React, { createContext, useContext, useState } from "react";

interface WorkflowContextType {
  isTraceviewComplete: boolean;
  setIsTraceviewComplete: React.Dispatch<React.SetStateAction<boolean>>;
}

const WorkflowContext = createContext<WorkflowContextType | undefined>(undefined);

export const WorkflowProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isTraceviewComplete, setIsTraceviewComplete] = useState(false);

  return (
    <WorkflowContext.Provider value={{ isTraceviewComplete, setIsTraceviewComplete }}>
      {children}
    </WorkflowContext.Provider>
  );
};

export const useWorkflow = (): WorkflowContextType => {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error("useWorkflow must be used within a WorkflowProvider");
  }
  return context;
};
