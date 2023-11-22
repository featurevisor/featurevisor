import * as React from "react";
import { useParams } from "react-router-dom";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

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

const attributeFormSchema = z.object({
  description: z.string().min(2, { message: "Description must be at least 2 characters long" }),
  type: z.enum(["string", "integer", "double", "boolean", "date"]),
  capture: z.boolean(),
  archived: z.boolean(),
});

type AttributeFormValues = z.infer<typeof attributeFormSchema>;

function AttributeForm({ initialAttribute }) {
  const { toast } = useToast();
  const form = useForm<AttributeFormValues>({
    resolver: zodResolver(attributeFormSchema),
    defaultValues: initialAttribute,
    mode: "onChange",
  });

  function onSubmit(data: AttributeFormValues) {
    console.log(data);

    // fetch("/api/user", {
    //   method: "PUT",
    //   headers: {
    //     "Content-Type": "application/json",
    //   },
    //   body: JSON.stringify(data),
    // })
    //   .then(() => {
    //     toast({
    //       title: "Success!",
    //       description: "Your profile has been updated.",
    //     });
    //   })
    //   .catch(() => {
    //     toast({
    //       variant: "destructive",
    //       title: "Failed to update :(",
    //       description: "An error occurred while updating your profile.",
    //     });
    //   });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Type */}
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type</FormLabel>

              <FormControl>
                <Input placeholder="" {...field} />
              </FormControl>

              <FormDescription>Type of your attribute</FormDescription>

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

        {/* Archived */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem className="flex items-center space-y-0 space-x-1">
              <FormControl>
                <Checkbox id="archived" placeholder="" {...field} />
              </FormControl>

              <FormLabel htmlFor="archived">Archive this attribute?</FormLabel>

              <FormMessage />
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

  React.useEffect(() => {
    fetch(`/api/attributes/${key}`)
      .then((res) => res.json())
      .then((data) => setInitialAttribute(data.data));
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
