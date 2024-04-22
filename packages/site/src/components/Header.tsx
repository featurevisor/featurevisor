import * as React from "react";
import { Link, NavLink } from "react-router-dom";

export function Header(props) {
  const { entitiesCount, revision } = props;
  const [isOpen, setIsOpen] = React.useState(false);

  React.useEffect(() => {
    console.log("entitiesCount", entitiesCount,revision);
  }, [entitiesCount,revision]);

  const navItems = [
    {
      title: "Features",
      to: "features",
      active: true,
    },
    {
      title: "Segments",
      to: "segments",
    },
    {
      title: "Attributes",
      to: "attributes",
    },
    {
      title: "History",
      to: "history",
    },
  ];

  return (
    <>
      <div className="bg-gray-800 lg:h-screen  fixed w-[18%] overflow-auto lg:block hidden">
        <nav className="mx-auto flex flex-col items-start justify-start px-8 pt-3 h-100">
          <Link to="/" className="text-gray-50 mb-8 flex align-middle justify-center w-full">
            <img alt="Featurevisor" src="/favicon-128.png" className="w-[63px]" />
          </Link>

          <div className="relative flex flex-col gap-y-4 w-full">
            {navItems.map((item) => (
              <NavLink
                key={item.title}
                to={item.to}
                className={({ isActive }) => {
                  return [
                    "relative",
                    "rounded-lg",
                    isActive ? "bg-gray-700" : "",
                    "px-3",
                    "py-2",
                    "text-sm",
                    "font-semibold",
                    "leading-6",
                    "text-gray-50",
                    "flex",
                    "justify-between",
                    "items-center",
                    "w-full",
                    "hover:bg-gray-600",
                  ].join(" ");
                }}
              >
                {item.title}
                {item.title != 'History' && <span className="inline-flex items-center justify-center w-3 h-3 p-3 ms-3 text-sm font-medium text-blue-800 bg-blue-100 rounded-full dark:bg-blue-900 dark:text-blue-300">
                  {entitiesCount[item.title.toLowerCase()] || 0}
                </span>}
              </NavLink>
            ))}
          </div>

          <div className="fixed flex flex-col gap-y-4 w-full px-3 text-gray-50 bottom-0">
           {revision}
          </div>
        </nav>
      </div>

      <div className="lg:hidden block bg-gray-800 w-full h-[60px] ">
        <nav className="mx-auto flex items-center justify-between px-8 h-full">
          <Link to="/" className="text-gray-50">
            <img alt="Featurevisor" src="/favicon-128.png" className="w-[36px]" />
          </Link>

          <button className="text-gray-50" onClick={() => setIsOpen(!isOpen)}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              className="w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5"
              />
            </svg>
          </button>

          <main
            className={
              " fixed overflow-hidden z-10 bg-gray-900 bg-opacity-25 inset-0 transform ease-in-out " +
              (isOpen
                ? " transition-opacity opacity-100 duration-500 translate-x-0  "
                : " transition-all delay-500 opacity-0 translate-x-full  ")
            }
          >
            <section
              className={
                " w-screen max-w-lg right-0 absolute bg-gray-800 h-full shadow-xl delay-400 duration-500 ease-in-out transition-all transform  " +
                (isOpen ? " translate-x-0 " : " translate-x-full ")
              }
            >
              <article className="relative w-screen max-w-lg pb-10 flex flex-col space-y-6 overflow-y-scroll h-full px-3">
                {/* <header className="p-4 font-bold text-lg">Header</header> */}
                <div className="relative flex flex-col gap-y-4 w-full pt-9">
                  {navItems.map((item) => (
                    <NavLink
                      key={item.title}
                      to={item.to}
                      className={({ isActive }) => {
                        return [
                          "relative",
                          "rounded-lg",
                          isActive ? "bg-gray-700" : "",
                          "px-3",
                          "py-2",
                          "text-sm",
                          "font-semibold",
                          "leading-6",
                          "text-gray-50",
                          "flex",
                          "justify-between",
                          "items-center",
                          "w-full",
                          "hover:bg-gray-600",
                        ].join(" ");
                      }}
                    >
                      {item.title}
                      {item.title != 'History' && <span className="inline-flex items-center justify-center w-3 h-3 p-3 ms-3 text-sm font-medium text-blue-800 bg-blue-100 rounded-full dark:bg-blue-900 dark:text-blue-300">
                        {entitiesCount[item.title.toLowerCase()] || 0}
                      </span>}
                    </NavLink>
                  ))}
                </div>

                <div className="fixed flex flex-col gap-y-4 w-full px-3 text-gray-50 bottom-0">
                  {revision}
                </div>
              </article>
            </section>
            <section
              className=" w-screen h-full cursor-pointer "
              onClick={() => {
                setIsOpen(false);
              }}
            ></section>
          </main>
        </nav>
      </div>
    </>
  );
}
