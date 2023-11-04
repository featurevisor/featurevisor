import * as React from "react";
import { Terminal } from "lucide-react";

import { Button } from "./ui/button";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

export function App() {
  return (
    <div>
      <h1>App here...</h1>

      <Button variant="outline">Button</Button>

      <Alert>
        <Terminal className="h-4 w-4" />
        <AlertTitle>Heads up!</AlertTitle>
        <AlertDescription>
          You can add components and dependencies to your app using the cli.
        </AlertDescription>
      </Alert>
    </div>
  );
}
