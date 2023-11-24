import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "../ui/select";

const attributeFormSchema = z.object({
  key: z.string().min(1, { message: "Key must be at least 1 character long" }),
  description: z.string().min(2, { message: "Description must be at least 2 characters long" }),
  type: z.enum(["string", "integer", "double", "boolean", "date"], {
    required_error: "You need to select a type",
  }),
  capture: z.boolean().default(false).optional(),
  archived: z.boolean().default(false).optional(),
});

type AttributeFormValues = z.infer<typeof attributeFormSchema>;

function AttributeForm({ initialAttribute = undefined }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const mode = initialAttribute === undefined ? "create" : "edit";

  const form = useForm<AttributeFormValues>({
    resolver: zodResolver(attributeFormSchema),
    defaultValues: initialAttribute,
    mode: "onChange",
  });

  function onSubmit(data: AttributeFormValues) {
    if (mode === "edit") {
      const { key, ...body } = data;

      fetch(`/api/attributes/${key}`, {
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
            description: "Attribute has been updated.",
          });
        });
    } else if (mode === "create") {
      fetch(`/api/attributes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
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
            description: "Attribute has been created.",
          });

          navigate(`/attributes/${data.key}`);
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
                  This your unique attribute key, that will be used in segments.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Type */}
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {["string", "integer", "double", "boolean", "date"].map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Learn more about attribute types{" "}
                <a href="https://featurevisor.com/docs/attributes/#types" className="underline">
                  here <ExternalLinkIcon className="inline w-4 h-4" />
                </a>
                .
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

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

              <FormDescription>Describe your attribute for documentation purposes.</FormDescription>

              <FormMessage />
            </FormItem>
          )}
        />

        {/* Capture */}
        <FormField
          control={form.control}
          name="capture"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Capture this attribute?</FormLabel>
                <FormDescription>
                  Learn more about capturing{" "}
                  <a
                    href="https://featurevisor.com/docs/attributes/#capturing-attributes"
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
                <FormLabel>Archive this attribute?</FormLabel>
                <FormDescription>
                  Learn more about archiving{" "}
                  <a
                    href="https://featurevisor.com/docs/attributes/#archiving"
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

        {/* Submit */}
        <Button type="submit">Update attribute</Button>
      </form>
    </Form>
  );
}

export function AttributePageEdit() {
  const [initialAttribute, setInitialAttribute] = React.useState(null);
  const { key } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (key) {
      fetch(`/api/attributes/${key}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.error) {
            toast({
              title: `Error`,
              description: data.error.message,
            });

            navigate("/attributes");

            return;
          }

          setInitialAttribute(data.data);
        });
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Edit attribute</h3>
        <p className="text-sm text-muted-foreground">Update your attribute via this form.</p>
      </div>

      <Separator />

      {initialAttribute ? <AttributeForm initialAttribute={initialAttribute} /> : <p>Loading...</p>}
    </div>
  );
}
