import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import * as z from "zod";
import { useForm } from "react-hook-form";
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

const segmentFormSchema = z.object({
  key: z.string().min(1, { message: "Key must be at least 1 character long" }),
  description: z.string().min(2, { message: "Description must be at least 2 characters long" }),
  archived: z.boolean().default(false).optional(),
  // @TODO: make it a proper conditions builder in UI later
  conditions: z.string().refine(
    (val) => {
      try {
        JSON.parse(val);
        return true;
      } catch (err) {
        return false;
      }
    },
    { message: "Conditions must be a valid JSON string" },
  ),
});

type SegmentFormValues = z.infer<typeof segmentFormSchema>;

function transformFormData(data: SegmentFormValues) {
  const { conditions, ...rest } = data;

  const transformedConditions = JSON.parse(conditions);

  return {
    ...rest,
    conditions: transformedConditions,
  };
}

export function SegmentForm({ initialSegment = undefined }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const mode = initialSegment === undefined ? "create" : "edit";

  const form = useForm<SegmentFormValues>({
    resolver: zodResolver(segmentFormSchema),
    defaultValues: initialSegment,
    mode: "onChange",
  });

  function onSubmit(data: SegmentFormValues) {
    const transformedData = transformFormData(data);
    console.log(mode, data, JSON.stringify(transformedData, null, 2));

    if (mode === "edit") {
      const { key, ...body } = transformedData;

      fetch(`/api/segments/${key}`, {
        method: "PUT",
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
            description: "Segment has been updated.",
          });
        });
    } else if (mode === "create") {
      fetch(`/api/segments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(transformedData),
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
            description: "Segment has been created.",
          });
          navigate(`/segments/${data.key}`);
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

        {/* Conditions */}
        <FormField
          control={form.control}
          name="conditions"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Conditions</FormLabel>

              <FormControl>
                <Textarea placeholder="[]" {...field} />
              </FormControl>

              <FormDescription>Your conditions in stringified form.</FormDescription>

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
    // initial segment
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

          setInitialSegment({
            ...data.data,
            // @TODO: make it a proper conditions builder in UI later
            conditions: JSON.stringify(data.data.conditions, null, 2),
          });
        });
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Edit Segment</h3>
        <p className="text-sm text-muted-foreground">Update your segment via this form.</p>
      </div>

      <Separator />

      {initialSegment ? <SegmentForm initialSegment={initialSegment} /> : <p>Loading...</p>}
    </div>
  );
}
