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

const plainConditionSchema = z.object({
  attribute: z.string(),
  operator: z.string(),
  value: z.union([z.string(), z.array(z.string()), z.boolean(), z.number(), z.date(), z.null()]),
});

const andConditionSchema = z.lazy(() =>
  z.object({
    and: conditionsSchema,
  }),
);

const orConditionSchema = z.lazy(() =>
  z.object({
    or: conditionsSchema,
  }),
);

const notConditionSchema = z.lazy(() =>
  z.object({
    not: conditionsSchema,
  }),
);

const conditionsSchema = z.array(
  z.union([plainConditionSchema, andConditionSchema, orConditionSchema, notConditionSchema]),
);

const segmentFormSchema = z.object({
  key: z.string().min(1, { message: "Key must be at least 1 character long" }),
  description: z.string().min(2, { message: "Description must be at least 2 characters long" }),
  archived: z.boolean().default(false).optional(),
  conditions: conditionsSchema,
});

type SegmentFormValues = z.infer<typeof segmentFormSchema>;

export function SegmentForm({ initialSegment = undefined }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const mode = initialSegment === undefined ? "create" : "edit";

  console.log("initialSegment", initialSegment);

  const form = useForm<SegmentFormValues>({
    resolver: zodResolver(segmentFormSchema),
    defaultValues: initialSegment,
    mode: "onChange",
  });

  const { fields, append } = useFieldArray({
    name: "conditions",
    control: form.control,
  });

  function onSubmit(data: SegmentFormValues) {
    console.log(mode, data);

    if (mode === "edit") {
      // const { key, ...body } = data;
      // fetch(`/api/attributes/${key}`, {
      //   method: "PUT",
      //   headers: {
      //     "Content-Type": "application/json",
      //   },
      //   body: JSON.stringify(body),
      // })
      //   .then((res) => res.json())
      //   .then((res) => {
      //     if (res.error) {
      //       toast({
      //         title: "Failed to update :(",
      //         description: res.error.message,
      //       });
      //       return;
      //     }
      //     toast({
      //       title: "Success!",
      //       description: "Attribute has been updated.",
      //     });
      //   });
    } else if (mode === "create") {
      // fetch(`/api/attributes`, {
      //   method: "POST",
      //   headers: {
      //     "Content-Type": "application/json",
      //   },
      //   body: JSON.stringify(data),
      // })
      //   .then((res) => res.json())
      //   .then((res) => {
      //     if (res.error) {
      //       toast({
      //         title: "Failed to create :(",
      //         description: res.error.message,
      //       });
      //       return;
      //     }
      //     toast({
      //       title: "Success!",
      //       description: "Attribute has been created.",
      //     });
      //     navigate(`/attributes/${data.key}`);
      //   });
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
                <FormDescription>
                  This your unique segment key, that will be used in rollout rules.
                </FormDescription>
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

              <FormDescription>Describe your segment for documentation purposes.</FormDescription>

              <FormMessage />
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
                <FormLabel>Archive this attribute?</FormLabel>
                <FormDescription>
                  Learn more about archiving{" "}
                  <a
                    href="https://featurevisor.com/docs/segments/#archiving"
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

        {/* Conditions */}
        {fields.map((field, index) => {
          console.log({ index, field });

          return (
            <div key={index} className="flex space-x-2">
              <FormField
                control={form.control}
                key={field.id}
                name={`conditions.${index}.attribute`}
                render={({ field }) => {
                  return (
                    <FormItem className="">
                      <FormLabel>Attribute</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              <FormField
                control={form.control}
                key={field.id}
                name={`conditions.${index}.operator`}
                render={({ field }) => {
                  return (
                    <FormItem className="">
                      <FormLabel>Operator</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              <FormField
                control={form.control}
                key={field.id}
                name={`conditions.${index}.value`}
                render={({ field }) => {
                  return (
                    <FormItem className="">
                      <FormLabel>Value</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => append({ attribute: "country", operator: "equals", value: "" })}
        >
          Add
        </Button>

        {/* Buttons */}
        <div className="flex space-x-4">
          <Button size="sm" type="submit">
            Submit
          </Button>

          {mode === "edit" && (
            <Link to={`/segments/${initialSegment.key}`}>
              <Button size="sm" variant="secondary">
                Cancel
              </Button>
            </Link>
          )}

          {mode === "create" && (
            <Link to={`/segments`}>
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

export function SegmentPageEdit() {
  const [initialSegment, setInitialSegment] = React.useState(null);
  const { key } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (key) {
      fetch(`/api/segments/${key}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.error) {
            toast({
              title: `Error`,
              description: data.error.message,
            });

            navigate("/segments");

            return;
          }

          const segment = data.data;

          if (!Array.isArray(segment.conditions)) {
            const andOrNot = Object.keys(segment.conditions)[0];

            // turn object in root level into array for ease of form handling
            segment.conditions = [
              {
                [andOrNot]: segment.conditions[andOrNot],
              },
            ];
          }

          setInitialSegment(data.data);
        });
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Edit Segment</h3>
        <p className="text-sm text-muted-foreground">Update your attribute via this form.</p>
      </div>

      <Separator />

      {initialSegment ? <SegmentForm initialSegment={initialSegment} /> : <p>Loading...</p>}
    </div>
  );
}
