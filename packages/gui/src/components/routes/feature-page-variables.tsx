import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import * as z from "zod";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import { ExternalLinkIcon, MoveIcon } from "@radix-ui/react-icons";

import { Separator } from "../ui/separator";
import {
  Form,
  FormControl,
  FormDescription,
  FormItem,
  FormField,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Checkbox } from "../ui/checkbox";
import { Button } from "../ui/button";
import { useToast } from "../ui/use-toast";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "../ui/select";

const variableSchema = z.object({
  key: z.string().min(1, { message: "Variable key must be at least 1 character long" }),
  type: z.enum(["string", "integer", "double", "boolean", "date", "array", "object", "json"]),
  default: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(
      z.object({
        value: z.string(),
      }),
    ),
  ]),
});

const featureVariablesFormSchema = z.object({
  key: z.string().min(1, { message: "Key must be at least 1 character long" }),
  variablesSchema: z.array(variableSchema),
});

type FeatureVariablesFormValues = z.infer<typeof featureVariablesFormSchema>;

function transformBodyForBackend(body: FeatureVariablesFormValues) {
  // @TODO: handle type conversions

  return body;
}

export function FeatureVariablesForm({ initialFeature = undefined }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const mode = initialFeature === undefined ? "create" : "edit";

  const form = useForm<FeatureVariablesFormValues>({
    resolver: zodResolver(featureVariablesFormSchema),
    defaultValues: {},
    mode: "onChange",
  });

  const { fields, append, remove, move } = useFieldArray({
    name: "variablesSchema",
    control: form.control,
  });

  const handleDragEnd = (result) => {
    if (!result.destination) {
      return;
    }

    move(result.source.index, result.destination.index);
  };

  function onSubmit(data: FeatureVariablesFormValues) {
    const { key, variablesSchema } = data;
    const body = variablesSchema;

    fetch(`/api/features/${key}/variables`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
      .then((res) => res.json())
      .then((res) => {
        if (res.error) {
          toast({
            title: "Failed to update :(",
            description: res.error.message,
          });

          return;
        }

        toast({
          title: "Success!",
          description: "Feature has been updated.",
        });
      });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Key */}
        {mode === "create" && (
          <FormField
            control={form.control}
            name="key"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Key</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormDescription>This your unique feature key.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* TODO: Description */}
        {/*<FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>

              <FormControl>
                <Textarea placeholder="" {...field} />
              </FormControl>

              <FormDescription>Describe your feature for documentation purposes.</FormDescription>

              <FormMessage />
            </FormItem>
          )}
        />*/}

        {/* Buttons */}
        <div className="flex space-x-4">
          <Button size="sm" type="submit">
            Submit
          </Button>

          <Link to={`/features/${initialFeature.key}`}>
            <Button size="sm" variant="secondary">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </Form>
  );
}

export function FeaturePageVariables() {
  const [initialFeature, setInitialFeature] = React.useState(null);
  const { key } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (key) {
      fetch(`/api/features/${key}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.error) {
            toast({
              title: `Error`,
              description: data.error.message,
            });

            navigate("/features");

            return;
          }

          setInitialFeature(data.data);
        });
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Variables</h3>
        <p className="text-sm text-muted-foreground">Update your feature's variables.</p>
      </div>

      <Separator />

      {initialFeature ? (
        <FeatureVariablesForm initialFeature={initialFeature} />
      ) : (
        <p>Loading...</p>
      )}
    </div>
  );
}
