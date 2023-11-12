import * as React from "react";
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
import { Button } from "../ui/button";
import { useToast } from "../ui/use-toast";

const profileFormSchema = z.object({
  name: z
    .string()
    .min(2, { message: "Name must be at least 2 characters long" })
    .max(30, { message: "Name must be at most 30 characters long" }),
  email: z.string().email({ message: "Invalid email address" }),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

function ProfileForm({ initialUser }) {
  const { toast } = useToast();
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: initialUser,
    mode: "onChange",
  });

  function onSubmit(data: ProfileFormValues) {
    console.log(data);

    fetch("/api/user", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    })
      .then(() => {
        toast({
          title: "Success!",
          description: "Your profile has been updated.",
        });
      })
      .catch(() => {
        toast({
          variant: "destructive",
          title: "Failed to update :(",
          description: "An error occurred while updating your profile.",
        });
      });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Name */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>

              <FormControl>
                <Input placeholder="" {...field} />
              </FormControl>

              <FormDescription>This is your public display name.</FormDescription>

              <FormMessage />
            </FormItem>
          )}
        />

        {/* Email */}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>

              <FormControl>
                <Input placeholder="" {...field} />
              </FormControl>

              <FormDescription>This is your public email address.</FormDescription>

              <FormMessage />
            </FormItem>
          )}
        />

        {/* Submit */}
        <Button type="submit">Update profile</Button>
      </form>
    </Form>
  );
}

export function SettingsPageProfile() {
  const [initialUser, setInitialUser] = React.useState(null);

  React.useEffect(() => {
    fetch("/api/user")
      .then((res) => res.json())
      .then((data) => setInitialUser(data.data));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Profile</h3>
        <p className="text-sm text-muted-foreground">
          This information will be used in your Git commits.
        </p>
      </div>

      <Separator />

      {initialUser ? <ProfileForm initialUser={initialUser} /> : <p>Loading...</p>}
    </div>
  );
}
