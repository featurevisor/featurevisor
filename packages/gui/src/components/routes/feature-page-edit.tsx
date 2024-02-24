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

const bucketByPlainSchema = z.string();
const bucketByArraySchema = z.array(
  z.object({
    value: z.string(),
  }),
);

const featureFormSchema = z.object({
  key: z.string().min(1, { message: "Key must be at least 1 character long" }),
  description: z.string().min(2, { message: "Description must be at least 2 characters long" }),
  deprecated: z.boolean().default(false).optional(),
  archived: z.boolean().default(false).optional(),

  // virtual fields for form only
  bucketByAs: z.string(), // plain, and, or
  bucketBySingle: bucketByPlainSchema.optional(),
  bucketByMultiple: bucketByArraySchema.optional(),
});

type FeatureFormValues = z.infer<typeof featureFormSchema>;

function transformBodyForBackend(body: FeatureFormValues) {
  const { bucketByAs, bucketBySingle, bucketByMultiple, ...rest } = body;

  let bucketBy;
  if (bucketByAs === "plain") {
    bucketBy = bucketBySingle;
  } else if (bucketByAs === "and") {
    bucketBy = bucketByMultiple.map((item) => item.value);
  } else if (bucketByAs === "or") {
    bucketBy = { or: bucketByMultiple.map((item) => item.value) };
  }

  return {
    ...rest,
    bucketBy,
    archived: rest.archived === true,
    deprecated: rest.deprecated === true,
  };
}

export function FeatureForm({ initialFeature = undefined }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const mode = initialFeature === undefined ? "create" : "edit";

  const form = useForm<FeatureFormValues>({
    resolver: zodResolver(featureFormSchema),
    defaultValues: initialFeature,
    mode: "onChange",
  });

  const { fields, append, remove, move } = useFieldArray({
    name: "bucketByMultiple",
    control: form.control,
  });

  const handleDragEnd = (result) => {
    if (!result.destination) {
      return;
    }

    move(result.source.index, result.destination.index);
  };

  const bucketByAs = form.watch("bucketByAs");

  function onSubmit(data: FeatureFormValues) {
    if (mode === "edit") {
      const { key, ...rest } = data;
      const body = transformBodyForBackend(rest);

      fetch(`/api/features/${key}`, {
        method: "PATCH",
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
    } else if (mode === "create") {
      const body = transformBodyForBackend(data);

      fetch(`/api/features`, {
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
              title: "Failed to create :(",
              description: res.error.message,
            });

            return;
          }

          toast({
            title: "Success!",
            description: "Feature has been created.",
          });

          navigate(`/features/${data.key}`);
        });
    }
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

        {/* Description */}
        <FormField
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
        />

        {/* Bucket by as */}
        <FormField
          control={form.control}
          name="bucketByAs"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bucketing approach</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {[
                    {
                      as: "plain",
                      title: (
                        <div>
                          <strong>Single attribute</strong>:{" "}
                          <span className="text-muted-foreground">recommended</span>
                        </div>
                      ),
                    },
                    {
                      as: "and",
                      title: (
                        <div>
                          <strong>Compound attributes</strong>:{" "}
                          <span className="text-muted-foreground">
                            Multiple attributes together
                          </span>
                        </div>
                      ),
                    },
                    {
                      as: "or",
                      title: (
                        <div>
                          <strong>Conditional attributes</strong>:{" "}
                          <span className="text-muted-foreground">
                            First available attribute used
                          </span>
                        </div>
                      ),
                    },
                  ].map(({ as, title }) => (
                    <SelectItem key={as} value={as}>
                      {title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Learn more about bucketing{" "}
                <a href="https://featurevisor.com/docs/features/#bucketing" className="underline">
                  here <ExternalLinkIcon className="inline w-4 h-4" />
                </a>
                .
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Bucket by plain (single attribute) */}
        {bucketByAs === "plain" && (
          <FormField
            control={form.control}
            name="bucketBySingle"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bucket by a single attribute</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                {/* <FormDescription>...</FormDescription> */}
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Bucket by or (multiple attributes) */}
        {["and", "or"].indexOf(bucketByAs) > -1 && (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="fields">
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef}>
                  <FormLabel className="">
                    {bucketByAs === "and"
                      ? "Bucket by multiple attributes together"
                      : "Bucket by first available attribute"}
                  </FormLabel>

                  {fields.map((field, index) => (
                    <Draggable key={field.id} draggableId={field.id} index={index}>
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                        >
                          <FormField
                            control={form.control}
                            key={field.id}
                            name={`bucketByMultiple.${index}.value`}
                            render={({ field }) => (
                              <FormItem className="cursor-default pt-2">
                                <FormControl>
                                  <div className="block">
                                    <Input {...field} className="w-1/3 inline" />{" "}
                                    <button
                                      className="inline ml-2 underline text-xs"
                                      onClick={() => remove(index)}
                                    >
                                      remove
                                    </button>
                                    <div className="inline ml-2 cursor-grab active:cursor-grabbing">
                                      <MoveIcon className="inline w-4 h-4" />
                                    </div>
                                  </div>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}

                  {provided.placeholder}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 block"
                    onClick={() => append({ value: "" })}
                  >
                    Add attribute
                  </Button>
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}

        {/* Deprecated */}
        {initialFeature && (
          <FormField
            control={form.control}
            name="deprecated"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Depreciate this feature?</FormLabel>
                  <FormDescription>
                    Learn more about deprecated{" "}
                    <a
                      href="https://featurevisor.com/docs/features/#deprecating"
                      className="underline"
                      target="_blank"
                    >
                      here <ExternalLinkIcon className="inline w-4 h-4" />
                    </a>
                    .
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />
        )}

        {/* Archived */}
        {initialFeature && (
          <FormField
            control={form.control}
            name="archived"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Archive this feature?</FormLabel>
                  <FormDescription>
                    Learn more about archiving{" "}
                    <a
                      href="https://featurevisor.com/docs/features/#archiving"
                      className="underline"
                      target="_blank"
                    >
                      here <ExternalLinkIcon className="inline w-4 h-4" />
                    </a>
                    .
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />
        )}

        {/* Buttons */}
        <div className="flex space-x-4">
          <Button size="sm" type="submit">
            Submit
          </Button>

          {mode === "edit" && (
            <Link to={`/features/${initialFeature.key}`}>
              <Button size="sm" variant="secondary">
                Cancel
              </Button>
            </Link>
          )}

          {mode === "create" && (
            <Link to={`/features`}>
              <Button size="sm" variant="secondary">
                Cancel
              </Button>
            </Link>
          )}
        </div>
      </form>
    </Form>
  );
}

function transformBodyForFrontend(body: any) {
  let bucketByAs = "plain";
  if (Array.isArray(body.bucketBy)) {
    bucketByAs = "and";
  } else if (body.bucketBy.or) {
    bucketByAs = "or";
  }

  let bucketByMultiple;
  if (bucketByAs === "and") {
    bucketByMultiple = body.bucketBy.map((value) => ({ value }));
  } else if (bucketByAs === "or") {
    bucketByMultiple = body.bucketBy.or.map((value) => ({ value }));
  }

  return {
    ...body,

    bucketByAs: bucketByAs,
    bucketBySingle: bucketByAs === "plain" ? body.bucketBy : undefined,

    // the `value` property is needed for form fields as an array
    bucketByMultiple,
  };
}

export function FeaturePageEdit() {
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

          setInitialFeature(transformBodyForFrontend(data.data));
        });
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Edit feature</h3>
        <p className="text-sm text-muted-foreground">Update your feature via this form.</p>
      </div>

      <Separator />

      {initialFeature ? <FeatureForm initialFeature={initialFeature} /> : <p>Loading...</p>}
    </div>
  );
}
