import * as React from "react";

function getPrettyDate(props) {
  const { showTime } = props;
  const date = new Date(props.date);

  const day = date.getDate();
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
  const year = date.getFullYear();

  const ordinalSuffix = (day: number) => {
    switch (day % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  };

  const prettyDate = `${day}${ordinalSuffix(day)} ${month} ${year}`;

  if (showTime) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    const prettyTime = `${hour12}:${minutes.toString().padStart(2, "0")}${ampm}`;

    return (
      <>
        <span className="font-normal text-gray-500">{prettyDate}</span>{" "}
        <span className="font-normal text-gray-500">at</span>{" "}
        <span className="font-normal text-gray-500">{prettyTime}</span>
      </>
    );
  }

  return prettyDate;
}

interface PrettyDateProps {
  date: string;
  showTime?: boolean;
}

export function PrettyDate(props: PrettyDateProps) {
  return <>{getPrettyDate(props)}</>;
}
