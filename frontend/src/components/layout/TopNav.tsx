"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, MapPin, User, LogOut } from "lucide-react";
import {
  Button,
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/trips", label: "Trips" },
  { href: "/explore", label: "Explore" },
];

interface TopNavProps {
  className?: string;
}

export function TopNav({ className }: TopNavProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full border-b border-neutral-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80",
        className
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 font-bold text-neutral-900 hover:opacity-80 transition-opacity">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500">
              <MapPin className="h-4 w-4 text-white" />
            </div>
            <span className="hidden sm:block text-sm font-semibold">Road Trip Planner</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-4 py-2 text-sm font-medium text-neutral-500 rounded-lg hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* User menu (desktop) */}
            <div className="hidden md:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded-full">
                    <Avatar className="h-8 w-8 cursor-pointer">
                      <AvatarFallback>U</AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem>
                    <User className="h-4 w-4 mr-2" />
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-error-500 focus:text-error-500">
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Mobile hamburger */}
            <div className="md:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Open menu">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[280px]">
                  <div className="flex flex-col gap-6 mt-8">
                    <div className="flex items-center gap-3 pb-4 border-b border-neutral-200">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback>U</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium text-neutral-900">User</p>
                        <p className="text-xs text-neutral-500">user@example.com</p>
                      </div>
                    </div>
                    <nav className="flex flex-col gap-1">
                      {navLinks.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          className="px-3 py-2.5 text-sm font-medium text-neutral-700 rounded-lg hover:bg-neutral-100 transition-colors"
                        >
                          {link.label}
                        </Link>
                      ))}
                    </nav>
                    <div className="mt-auto pt-4 border-t border-neutral-200">
                      <button className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-error-500 rounded-lg hover:bg-red-50 w-full transition-colors">
                        <LogOut className="h-4 w-4" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
