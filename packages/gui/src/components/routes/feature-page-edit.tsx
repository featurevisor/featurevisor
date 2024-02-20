import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import * as z from "zod";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLinkIcon } from "@radix-ui/react-icons";

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
import { cn } from "../../utils";

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

    // if false, remove the key from the body
    deprecated: body.deprecated || undefined,
    archived: body.archived || undefined,
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

  const { fields, append } = useFieldArray({
    name: "bucketByMultiple",
    control: form.control,
  });

  const bucketAs = form.watch("bucketByAs");

  function onSubmit(data: FeatureFormValues) {
    if (mode === "edit") {
      const { key, ...rest } = data;
      const body = transformBodyForBackend(rest);

      console.log(data);
      console.log(body);
      return;

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
        {bucketAs === "plain" && (
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
        {bucketAs !== "plain" && (
          <div>
            {fields.map((field, index) => (
              <FormField
                control={form.control}
                key={field.id}
                name={`bucketByMultiple.${index}.value`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={cn(index !== 0 && "sr-only")}>
                      {bucketAs === "and"
                        ? "Bucket by multiple attributes together"
                        : "Bucket by first available attribute"}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => append({ value: "" })}
            >
              Add attribute
            </Button>
          </div>
        )}

        {/* Deprecated */}
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

        {/* Archived */}
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
  let as = "plain";
  if (Array.isArray(body.bucketBy)) {
    as = "and";
  } else if (body.bucketBy.or) {
    as = "or";
  }

  let bucketByMultiple;
  if (as === "and") {
    bucketByMultiple = body.bucketBy.map((value) => ({ value }));
  } else if (as === "or") {
    bucketByMultiple = body.bucketBy.or.map((value) => ({ value }));
  }

  return {
    ...body,

    bucketByAs: as,
    bucketBySingle: as === "plain" ? body.bucketBy : undefined,

    // the `value` property is needed for form fields as an array
    bucketByMultiple,
  };
}

export function FeaturePageEdit() {
  const [initialFeature, setInitialFeature] = React.useState(null);
  const { key } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();

  console.log("initialFeature", initialFeature);

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