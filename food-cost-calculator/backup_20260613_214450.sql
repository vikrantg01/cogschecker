--
-- PostgreSQL database dump
--

\restrict oJj94sdGpzKWObmUmPt03vH3dfoYGuYqWqLVoa27V1pueQM8ciSJeS22DgLcb8V

-- Dumped from database version 15.16
-- Dumped by pg_dump version 15.16

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_insights; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    venue_id uuid NOT NULL,
    insight_type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    explanation text,
    supporting_data jsonb,
    recommended_action text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ai_insights_insight_type_check CHECK (((insight_type)::text = ANY (ARRAY[('recipe_profitability'::character varying)::text, ('supplier_cost'::character varying)::text]))),
    CONSTRAINT ai_insights_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('actioned'::character varying)::text, ('dismissed'::character varying)::text])))
);


ALTER TABLE public.ai_insights OWNER TO postgres;

--
-- Name: TABLE ai_insights; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.ai_insights IS 'AI-generated profitability and supplier cost insights (Pro+ tier)';


--
-- Name: flyway_schema_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.flyway_schema_history (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


ALTER TABLE public.flyway_schema_history OWNER TO postgres;

--
-- Name: ingredients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ingredients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    venue_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    purchase_price numeric(10,2) NOT NULL,
    purchase_quantity numeric(10,4) NOT NULL,
    unit_of_measure character varying(10) NOT NULL,
    yield_percentage numeric(5,2) DEFAULT 100.00 NOT NULL,
    cost_per_unit numeric(10,4),
    effective_cost_per_usable_unit numeric(10,4),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ingredients_purchase_price_check CHECK ((purchase_price > (0)::numeric)),
    CONSTRAINT ingredients_purchase_quantity_check CHECK ((purchase_quantity > (0)::numeric)),
    CONSTRAINT ingredients_unit_of_measure_check CHECK (((unit_of_measure)::text = ANY (ARRAY[('g'::character varying)::text, ('kg'::character varying)::text, ('oz'::character varying)::text, ('lb'::character varying)::text, ('ml'::character varying)::text, ('L'::character varying)::text, ('tsp'::character varying)::text, ('tbsp'::character varying)::text, ('cup'::character varying)::text, ('each'::character varying)::text]))),
    CONSTRAINT ingredients_yield_percentage_check CHECK (((yield_percentage >= (1)::numeric) AND (yield_percentage <= (100)::numeric)))
);


ALTER TABLE public.ingredients OWNER TO postgres;

--
-- Name: TABLE ingredients; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.ingredients IS 'Ingredient library with pricing, quantities, units of measure, and yield percentages';


--
-- Name: invoice_line_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    extracted_name character varying(255),
    extracted_quantity numeric(10,4),
    extracted_unit character varying(50),
    extracted_price numeric(10,2),
    confidence_score numeric(4,3),
    is_low_confidence boolean DEFAULT false NOT NULL,
    matched_ingredient_id uuid,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT invoice_line_items_confidence_score_check CHECK (((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric))),
    CONSTRAINT invoice_line_items_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('confirmed'::character varying)::text, ('dismissed'::character varying)::text])))
);


ALTER TABLE public.invoice_line_items OWNER TO postgres;

--
-- Name: TABLE invoice_line_items; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.invoice_line_items IS 'OCR-extracted line items from uploaded supplier invoices';


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    venue_id uuid NOT NULL,
    file_name character varying(255) NOT NULL,
    s3_key character varying(1024) NOT NULL,
    uploaded_by uuid,
    upload_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    processing_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    extracted_item_count integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT invoices_processing_status_check CHECK (((processing_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('review'::character varying)::text, ('confirmed'::character varying)::text, ('failed'::character varying)::text])))
);


ALTER TABLE public.invoices OWNER TO postgres;

--
-- Name: TABLE invoices; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.invoices IS 'Supplier invoice uploads for automated ingredient pricing (Pro/Pro+ tier)';


--
-- Name: organisations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.organisations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.organisations OWNER TO postgres;

--
-- Name: TABLE organisations; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.organisations IS 'Top-level accounts that own one or more venues';


--
-- Name: recipe_ingredient_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recipe_ingredient_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipe_id uuid NOT NULL,
    ingredient_id uuid,
    sub_recipe_id uuid,
    quantity_used numeric(10,4) NOT NULL,
    unit_of_measure character varying(10) NOT NULL,
    line_cost numeric(10,4),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT recipe_ingredient_lines_check CHECK ((((ingredient_id IS NOT NULL) AND (sub_recipe_id IS NULL)) OR ((ingredient_id IS NULL) AND (sub_recipe_id IS NOT NULL)))),
    CONSTRAINT recipe_ingredient_lines_quantity_used_check CHECK ((quantity_used > (0)::numeric)),
    CONSTRAINT recipe_ingredient_lines_unit_of_measure_check CHECK (((unit_of_measure)::text = ANY (ARRAY[('g'::character varying)::text, ('kg'::character varying)::text, ('oz'::character varying)::text, ('lb'::character varying)::text, ('ml'::character varying)::text, ('L'::character varying)::text, ('tsp'::character varying)::text, ('tbsp'::character varying)::text, ('cup'::character varying)::text, ('each'::character varying)::text])))
);


ALTER TABLE public.recipe_ingredient_lines OWNER TO postgres;

--
-- Name: TABLE recipe_ingredient_lines; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.recipe_ingredient_lines IS 'Ingredient lines within recipes, supporting both ingredients and sub-recipes (mutually exclusive)';


--
-- Name: CONSTRAINT recipe_ingredient_lines_check ON recipe_ingredient_lines; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON CONSTRAINT recipe_ingredient_lines_check ON public.recipe_ingredient_lines IS 'XOR constraint ensuring exactly one of ingredient_id or sub_recipe_id is set';


--
-- Name: recipes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recipes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    venue_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    portion_count integer NOT NULL,
    menu_selling_price numeric(10,2),
    total_batch_cost numeric(10,2),
    food_cost_per_portion numeric(10,2),
    food_cost_percentage numeric(5,1),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT recipes_menu_selling_price_check CHECK (((menu_selling_price IS NULL) OR (menu_selling_price > (0)::numeric))),
    CONSTRAINT recipes_portion_count_check CHECK (((portion_count >= 1) AND (portion_count <= 9999)))
);


ALTER TABLE public.recipes OWNER TO postgres;

--
-- Name: TABLE recipes; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.recipes IS 'Recipe library with portions, costs, and food cost percentages';


--
-- Name: square_connections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.square_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    venue_id uuid NOT NULL,
    square_merchant_id character varying(255) NOT NULL,
    access_token_encrypted bytea NOT NULL,
    refresh_token_encrypted bytea NOT NULL,
    token_expires_at timestamp with time zone NOT NULL,
    last_synced_at timestamp with time zone,
    sync_status character varying(20) DEFAULT 'idle'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT square_connections_sync_status_check CHECK (((sync_status)::text = ANY (ARRAY[('idle'::character varying)::text, ('syncing'::character varying)::text, ('error'::character varying)::text])))
);


ALTER TABLE public.square_connections OWNER TO postgres;

--
-- Name: TABLE square_connections; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.square_connections IS 'Square POS OAuth connection details per venue (Pro/Pro+ tier)';


--
-- Name: square_unmatched_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.square_unmatched_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    venue_id uuid NOT NULL,
    square_item_name character varying(255) NOT NULL,
    square_item_price numeric(10,2),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    mapped_recipe_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT square_unmatched_items_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('mapped'::character varying)::text, ('dismissed'::character varying)::text])))
);


ALTER TABLE public.square_unmatched_items OWNER TO postgres;

--
-- Name: TABLE square_unmatched_items; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.square_unmatched_items IS 'Square menu items that could not be automatically matched to recipes';


--
-- Name: subscription_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscription_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organisation_id uuid NOT NULL,
    event_type character varying(50) NOT NULL,
    from_tier character varying(20),
    to_tier character varying(20),
    stripe_event_id character varying(255),
    description character varying(500),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT subscription_history_event_type_check CHECK (((event_type)::text = ANY (ARRAY[('CREATED'::character varying)::text, ('UPGRADED'::character varying)::text, ('DOWNGRADED'::character varying)::text, ('DOWNGRADE_SCHEDULED'::character varying)::text, ('DOWNGRADE_CANCELLED'::character varying)::text, ('PAYMENT_SUCCEEDED'::character varying)::text, ('PAYMENT_FAILED'::character varying)::text, ('PAYMENT_RECOVERED'::character varying)::text]))),
    CONSTRAINT subscription_history_from_tier_check CHECK (((from_tier)::text = ANY (ARRAY[('free'::character varying)::text, ('pro'::character varying)::text, ('pro_plus'::character varying)::text]))),
    CONSTRAINT subscription_history_to_tier_check CHECK (((to_tier)::text = ANY (ARRAY[('free'::character varying)::text, ('pro'::character varying)::text, ('pro_plus'::character varying)::text])))
);


ALTER TABLE public.subscription_history OWNER TO postgres;

--
-- Name: TABLE subscription_history; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.subscription_history IS 'History of subscription tier changes and payment events for organisations';


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organisation_id uuid NOT NULL,
    tier character varying(20) DEFAULT 'free'::character varying NOT NULL,
    stripe_customer_id character varying(255),
    stripe_subscription_id character varying(255),
    current_period_end timestamp with time zone,
    pending_downgrade_tier character varying(20),
    payment_failed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT subscriptions_pending_downgrade_tier_check CHECK ((((pending_downgrade_tier)::text = ANY (ARRAY[('FREE'::character varying)::text, ('PRO'::character varying)::text, ('PRO_PLUS'::character varying)::text])) OR (pending_downgrade_tier IS NULL))),
    CONSTRAINT subscriptions_tier_check CHECK (((tier)::text = ANY (ARRAY[('FREE'::character varying)::text, ('PRO'::character varying)::text, ('PRO_PLUS'::character varying)::text])))
);


ALTER TABLE public.subscriptions OWNER TO postgres;

--
-- Name: TABLE subscriptions; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.subscriptions IS 'Subscription tier and billing information for organisations';


--
-- Name: system_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_config (
    venue_id uuid NOT NULL,
    target_food_cost_percentage numeric(5,1) DEFAULT 30.0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT system_config_target_food_cost_percentage_check CHECK (((target_food_cost_percentage >= (1)::numeric) AND (target_food_cost_percentage <= (100)::numeric)))
);


ALTER TABLE public.system_config OWNER TO postgres;

--
-- Name: TABLE system_config; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.system_config IS 'Venue-specific configuration settings including target food cost percentage';


--
-- Name: user_organisation_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_organisation_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organisation_id uuid NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.user_organisation_roles OWNER TO postgres;

--
-- Name: TABLE user_organisation_roles; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.user_organisation_roles IS 'Organisation-level admin role assignments';


--
-- Name: user_venue_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_venue_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    venue_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT user_venue_roles_role_check CHECK (((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('manager'::character varying)::text, ('staff'::character varying)::text])))
);


ALTER TABLE public.user_venue_roles OWNER TO postgres;

--
-- Name: TABLE user_venue_roles; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.user_venue_roles IS 'Venue-specific role assignments (admin, manager, staff)';


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying(255) NOT NULL,
    display_name character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.users IS 'User accounts (matches Cognito user IDs)';


--
-- Name: venues; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.venues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organisation_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    address text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.venues OWNER TO postgres;

--
-- Name: TABLE venues; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.venues IS 'Physical cafe or restaurant locations belonging to organisations';


--
-- Data for Name: ai_insights; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ai_insights (id, venue_id, insight_type, title, explanation, supporting_data, recommended_action, status, generated_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: flyway_schema_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.flyway_schema_history (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	create core tables	SQL	V1__create_core_tables.sql	-238016949	postgres	2026-06-05 21:59:46.105548	54	t
2	2	create ingredient recipe tables	SQL	V2__create_ingredient_recipe_tables.sql	709814796	postgres	2026-06-05 21:59:46.177544	25	t
3	3	create pro proplus tables	SQL	V3__create_pro_proplus_tables.sql	-243011657	postgres	2026-06-05 21:59:46.211964	52	t
4	4	create subscription history table	SQL	V4__create_subscription_history_table.sql	1126247286	postgres	2026-06-05 21:59:46.271974	10	t
\.


--
-- Data for Name: ingredients; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ingredients (id, venue_id, name, purchase_price, purchase_quantity, unit_of_measure, yield_percentage, cost_per_unit, effective_cost_per_usable_unit, created_at, updated_at) FROM stdin;
6fc04b61-6564-451d-af2d-cf6a3c86c6ca	f56d7f13-6ba2-41fc-999b-d13bd6fd1ac8	MILK	3.20	2.0000	L	100.00	1.6000	1.6000	2026-06-07 04:07:45.455134+00	2026-06-07 04:07:45.455135+00
6e082872-9b9d-4a57-a260-bdd7f4e51a68	f56d7f13-6ba2-41fc-999b-d13bd6fd1ac8	qq	1.00	1.0000	L	100.00	1.0000	1.0000	2026-06-07 04:08:12.532889+00	2026-06-07 04:08:12.532889+00
14d93239-c9f4-4f9e-8038-5c005a1856b2	70fbf7b7-b22d-44fa-87ec-3ac9dad027df	SS	1.00	1.0000	g	100.00	1.0000	1.0000	2026-06-07 04:24:03.532335+00	2026-06-07 04:24:03.532335+00
e695ed43-fb13-4ffd-a673-84b98f6f55e8	70fbf7b7-b22d-44fa-87ec-3ac9dad027df	FULL CREAM MILK 2LT PAULS	3.20	2.0000	L	100.00	1.6000	1.6000	2026-06-07 05:02:33.848571+00	2026-06-07 05:02:33.848571+00
f89b376e-2021-42d0-aa1a-5460b0d027fa	70fbf7b7-b22d-44fa-87ec-3ac9dad027df	TRIM MILK 2LT PAULS	3.20	2.0000	L	100.00	1.6000	1.6000	2026-06-07 05:03:01.800807+00	2026-06-07 05:03:01.800807+00
603fc1cd-8a88-47d7-b06c-2429947d0a35	49ac8102-5c89-4ffe-b1c9-8cbedba054a5	AAA	11.00	1.0000	g	100.00	11.0000	11.0000	2026-06-07 05:13:36.408366+00	2026-06-07 05:13:36.408366+00
4ef3a779-fad8-45e7-907a-f14c06e4af51	21fca359-5d92-4493-8905-f8443364c58d	AA	1.00	1.0000	L	100.00	1.0000	1.0000	2026-06-07 05:28:47.118211+00	2026-06-07 05:28:47.118212+00
3b4de7b0-4956-462b-9718-3bff43bdf2a7	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	PROVOLONE SLICED 1KG	29.90	1000.0000	g	100.00	0.0299	0.0299	2026-06-08 07:05:06.465169+00	2026-06-08 07:05:06.46517+00
1ed73add-8fb4-4153-9626-790b687c46f7	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	HALOUMI CHEESE 750G CHEFS	15.35	750.0000	g	100.00	0.0205	0.0205	2026-06-08 07:05:06.465152+00	2026-06-08 07:05:06.465153+00
87c0697e-1121-4e89-80d6-052d004ec00b	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	SYRUP VANILLA 700ML MONIN	15.79	700.0000	ml	100.00	0.0226	0.0226	2026-06-08 07:05:06.465169+00	2026-06-08 07:05:06.46517+00
d3f312d9-f794-4a45-851e-fd93aedacb6b	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	ALMOND MILK 8X1LT MILK LAB	28.35	8000.0000	ml	100.00	0.0035	0.0035	2026-06-08 07:10:27.809478+00	2026-06-08 07:10:27.809479+00
7395663d-95f0-41ee-b8cf-c6e615fba4f4	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	FULL CREAM MILK 2LT PAULS	3.20	2000.0000	ml	100.00	0.0016	0.0016	2026-06-08 07:10:27.809476+00	2026-06-08 07:10:27.809476+00
5f2eff4d-ed00-4057-8215-338ca01d970f	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	TRIM MILK 2LT PAULS	3.20	2000.0000	ml	100.00	0.0016	0.0016	2026-06-08 07:10:27.809476+00	2026-06-08 07:10:27.809476+00
53dec182-3edd-4706-9fac-c85fac6eb9ad	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	BONSOY 6 PACK	19.00	6000.0000	ml	100.00	0.0032	0.0032	2026-06-08 07:10:27.810737+00	2026-06-08 07:10:27.810737+00
b74a68c4-d168-4eeb-a198-acb60c197c4d	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	LACTOSE FREE MILK 12X1LT MILK LAB	31.15	12000.0000	ml	100.00	0.0026	0.0026	2026-06-08 07:10:27.8114+00	2026-06-08 07:10:27.8114+00
2a4c47dd-dbad-4cca-bee6-6b556f060062	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	OAT MILK 12 X 1LT ALTERNATIVE DAIRY CO	33.00	12000.0000	ml	100.00	0.0028	0.0028	2026-06-08 07:10:27.811109+00	2026-06-08 07:10:27.811109+00
d691b1a9-4df8-41ac-905c-accea8aca13d	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	DRINKING CHOCOLATE 25% 1KG	11.30	1000.0000	g	100.00	0.0113	0.0113	2026-06-08 07:10:27.817886+00	2026-06-08 07:10:27.817886+00
d89a2634-1398-41fc-8947-85c4693bab4a	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	GREEK YOGHURT 2KG JALNA	13.20	2000.0000	g	100.00	0.0066	0.0066	2026-06-08 07:12:20.247754+00	2026-06-08 07:12:20.247755+00
7420650a-3ced-45d1-93c9-67caa5359fe1	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	CHAI ORGANIC 1KG POWDER REAL CHAI	42.25	1000.0000	g	100.00	0.0423	0.0423	2026-06-08 07:12:20.255664+00	2026-06-08 07:12:20.255665+00
91d2aa15-3da8-48c2-9018-6ce7b0d66e93	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	MAYONNAISE WHOLE EGG 10LT B&W	88.00	10000.0000	ml	100.00	0.0088	0.0088	2026-06-08 07:12:20.25619+00	2026-06-08 07:12:20.25619+00
e514f49a-bf44-42ee-9381-d78666f1c2bf	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	SYRUP CARAMEL 700ML MONIN	15.79	700.0000	ml	100.00	0.0226	0.0226	2026-06-08 07:12:20.257738+00	2026-06-08 07:12:20.257738+00
7d31abe4-bcb2-4bb8-abac-8d4bab42b003	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	EQUAL STICKS 500PCS	35.00	500.0000	each	100.00	0.0700	0.0700	2026-06-08 07:14:40.688524+00	2026-06-08 07:14:40.688524+00
74bd0163-31f8-44b4-a89c-97492976e651	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	BREAD G/F LIGHT GOLDEN BROWN 4 X 1.1KG NONIE'S	54.00	4400.0000	g	100.00	0.0123	0.0123	2026-06-08 08:39:39.428108+00	2026-06-08 08:39:39.428108+00
44f63b86-7868-41f2-ba78-0a5ce7655073	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Loaf Wholewheat Miche 1.2kg Thick Sliced	12.64	1200.0000	g	100.00	0.0105	0.0105	2026-06-08 12:47:26.674947+00	2026-06-08 12:47:26.674948+00
0bc16cb6-e4a5-4713-bc7e-e4040229d4c5	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Loaf Cafe Country 1.15kg Thick Sliced	12.56	1150.0000	g	100.00	0.0109	0.0109	2026-06-08 12:47:26.674849+00	2026-06-08 12:47:26.67485+00
9ddd7df6-508e-42b4-8a7f-9d443a13d80c	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Croissant Plain 6 PCK	14.96	6.0000	each	100.00	2.4933	2.4933	2026-06-08 12:47:26.674849+00	2026-06-08 12:47:26.67485+00
87b14d10-55e0-42b9-89d9-af21f1ce2bc4	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Croissant Almond 6 PCK	29.77	6.0000	each	100.00	4.9617	4.9617	2026-06-08 12:48:28.078666+00	2026-06-08 12:48:28.078667+00
758b93d4-6acd-4b75-b19b-f4317fbb8e90	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Ciabatta SEEDED - RECTANGLE	1.25	1.0000	each	100.00	1.2500	1.2500	2026-06-08 23:28:36.389113+00	2026-06-08 23:28:36.389114+00
d95bb0e7-5e51-4bcb-8c83-561e633a6f41	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Bag of 12: English Muffins	20.00	12.0000	each	100.00	1.6667	1.6667	2026-06-08 23:28:36.389113+00	2026-06-08 23:28:36.389114+00
baf79b72-9df8-41b7-8446-5c910af3d33d	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Banana Bread	25.50	10.0000	each	100.00	2.5500	2.5500	2026-06-08 23:28:36.391045+00	2026-06-08 23:28:36.391045+00
8f910168-7de3-41c5-9780-d2762a8cf820	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Toasted Muesli 3kg	30.00	3000.0000	g	100.00	0.0100	0.0100	2026-06-08 23:29:57.712007+00	2026-06-08 23:29:57.712007+00
6684185c-a71f-4d8f-8005-8aec421ec73d	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Pork Mince r/w 5kg	60.93	5082.0000	g	100.00	0.0120	0.0120	2026-06-08 23:48:31.884497+00	2026-06-08 23:48:31.884498+00
01065bb8-a87e-4c5d-a33e-e38655027317	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Zammit- Bacon Streaky Rindless 3kg	46.57	3000.0000	g	100.00	0.0155	0.0155	2026-06-08 23:48:31.884497+00	2026-06-08 23:48:31.884498+00
302a7e00-a9b6-49f6-b276-cfcaf8a5aea5	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Paesanella- Fior Di Latte 1kg	19.35	1000.0000	g	100.00	0.0194	0.0194	2026-06-08 23:48:31.8873+00	2026-06-08 23:48:31.8873+00
056fbd21-e8ad-4f98-839b-4096cb2d2f2b	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Sapore- Roasted Red Peppers Strips A12	18.78	1.0000	each	100.00	18.7800	18.7800	2026-06-08 23:48:50.084112+00	2026-06-08 23:48:50.084113+00
42cd58b5-6b39-42fe-a922-6963033a9f85	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	FZ CHIPS - SHOE STRING 7MM 4*3KG EDGELL EDGL	45.00	12000.0000	g	100.00	0.0038	0.0038	2026-06-13 11:16:02.463585+00	2026-06-13 11:16:02.463585+00
e0c9770a-cfcc-4bae-808b-cb7aa065945e	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	CHEESE - TASTY SLICED 1.5KG 90'S (8) CHEESE KING SEPT	19.15	1500.0000	g	100.00	0.0128	0.0128	2026-06-13 11:16:02.463585+00	2026-06-13 11:16:02.463585+00
7f276407-eede-4005-bb09-f7a6c9695433	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	VINEGAR - WHITE 5LTR (3) SUPRA	6.45	5000.0000	ml	100.00	0.0013	0.0013	2026-06-13 11:16:02.463583+00	2026-06-13 11:16:02.463584+00
224aaa93-65fc-490c-9ff9-c33d6ad22571	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	UHT - ALMOND MILK 1LT (8) MILK LAB	26.75	8000.0000	ml	100.00	0.0033	0.0033	2026-06-13 11:16:02.463586+00	2026-06-13 11:16:02.463586+00
fa3c1216-66ba-42d4-86cf-a31f5cd9188e	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	OIL - OLIVE EXTRA VIRGIN 4LTR (4) VALEDA	45.00	4000.0000	ml	100.00	0.0113	0.0113	2026-06-13 11:16:02.463586+00	2026-06-13 11:16:02.463587+00
e1f676aa-c707-4cce-bad7-6eca8a895541	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	CHEESE - HALLOUMI PDO 750G (5) CYPRIANA	14.65	750.0000	g	100.00	0.0195	0.0195	2026-06-13 11:16:02.463583+00	2026-06-13 11:16:02.463584+00
9021e53d-23b3-421d-8704-5a0d5700cec8	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	TOPPING - STRAWBERRY TOPPING 3LTR(4) COTTEE'S	12.65	3000.0000	ml	100.00	0.0042	0.0042	2026-06-13 11:16:02.484575+00	2026-06-13 11:16:02.484575+00
75782ca0-6b59-404d-a1d6-7d78a515812b	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	BUTTER - AUS BUTTER UNSALTED 1KG (10)	15.00	1000.0000	g	100.00	0.0150	0.0150	2026-06-13 11:16:02.484765+00	2026-06-13 11:16:02.484765+00
76dfffb3-380e-47ab-b9ec-54ff0676c733	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	SAUCE - TOMATO GLUTEN FREE 4 LIT (3) MASTERFOODS	19.35	4000.0000	ml	100.00	0.0048	0.0048	2026-06-13 11:16:02.484575+00	2026-06-13 11:16:02.484575+00
5cde16d7-0c24-4855-b55c-3d168f49a657	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	TOPPING - CHOCOLATE TOPPING 3LTR (4) COTTEE'S	12.65	3000.0000	ml	100.00	0.0042	0.0042	2026-06-13 11:16:02.50406+00	2026-06-13 11:16:02.50406+00
1654ad00-d3ca-44d1-8306-7d4f21d4344b	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	UHT - SOY MILK 1LTR(6) BONSOY	18.80	6000.0000	ml	100.00	0.0031	0.0031	2026-06-13 11:16:02.509173+00	2026-06-13 11:16:02.509173+00
c025d946-a519-428c-a1ba-29654ad1a5d6	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	NUTS - WALNUTS HALVES & PIECES 1KG (10) TRUMP	20.60	1000.0000	g	100.00	0.0206	0.0206	2026-06-13 11:16:02.520937+00	2026-06-13 11:16:02.520937+00
c0442463-2024-4b73-a8ad-59c01bcaf3f6	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	PAPER BAGS - 3F 240X200MM BROWN 500PCS	13.30	500.0000	each	100.00	0.0266	0.0266	2026-06-13 11:17:06.808902+00	2026-06-13 11:17:06.808903+00
31842ce7-6f78-475e-bb73-17c8174f3e9f	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	EGGS - 700G Free Bulk 6X30 BULK FREE RANGE	72.00	180.0000	each	100.00	0.4000	0.4000	2026-06-13 11:17:06.808908+00	2026-06-13 11:17:06.808908+00
301cebc0-68ce-4ed0-85a8-eb09007aa2ab	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	PAPER BAGS - 4F 270X240MM BROWN 500PCS	15.45	500.0000	each	100.00	0.0309	0.0309	2026-06-13 11:17:06.808902+00	2026-06-13 11:17:06.808903+00
76d530b6-ed37-4ef8-80c6-421c32a02676	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	CHICKEN - WHOLE BIRD NO.13 (10)	9.80	1.0000	each	100.00	9.8000	9.8000	2026-06-13 11:17:18.688634+00	2026-06-13 11:17:18.688634+00
\.


--
-- Data for Name: invoice_line_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.invoice_line_items (id, invoice_id, extracted_name, extracted_quantity, extracted_unit, extracted_price, confidence_score, is_low_confidence, matched_ingredient_id, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.invoices (id, venue_id, file_name, s3_key, uploaded_by, upload_date, processing_status, extracted_item_count, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: organisations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.organisations (id, name, created_at, updated_at) FROM stdin;
00000000-0000-0000-0000-000000000001	Test Organisation	2026-06-06 13:59:55.337177+00	2026-06-06 13:59:55.337177+00
00000000-0000-0000-0000-000000000002	Test Organisation	2026-06-07 07:32:54.557459+00	2026-06-07 07:32:54.557459+00
\.


--
-- Data for Name: recipe_ingredient_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.recipe_ingredient_lines (id, recipe_id, ingredient_id, sub_recipe_id, quantity_used, unit_of_measure, line_cost, created_at, updated_at) FROM stdin;
e7220fbd-d822-47e2-af94-d578d811e890	52ccbcaf-2311-4243-a4a8-765b654d4631	14d93239-c9f4-4f9e-8038-5c005a1856b2	\N	0.1000	g	0.1000	2026-06-07 04:47:40.815332+00	2026-06-07 04:47:40.843613+00
b7563251-be3c-4d98-9606-d31653cedf25	39efce22-9ca2-4b37-b50f-95474cd69aa1	14d93239-c9f4-4f9e-8038-5c005a1856b2	\N	5.0000	g	5.0000	2026-06-07 04:49:24.914063+00	2026-06-07 04:49:24.922059+00
6b6c0db5-6351-4cde-81ce-c960819618f0	58642898-6dde-4595-9592-acc627386a00	e695ed43-fb13-4ffd-a673-84b98f6f55e8	\N	1.0000	L	1.6000	2026-06-07 05:03:42.49448+00	2026-06-07 05:03:42.535831+00
cf616f56-8594-4228-a09f-c5b1485700d8	58642898-6dde-4595-9592-acc627386a00	\N	39efce22-9ca2-4b37-b50f-95474cd69aa1	1.0000	each	5.0000	2026-06-07 05:03:42.525129+00	2026-06-07 05:03:42.535831+00
2e9d1cba-f36e-43b1-870a-98e41b3e61b9	b217d1af-7781-4e6b-b969-516d49738da6	e695ed43-fb13-4ffd-a673-84b98f6f55e8	\N	1.0000	L	1.6000	2026-06-07 05:06:47.517196+00	2026-06-07 05:06:47.517196+00
394f5d92-3b73-40c0-ad18-23f86c7afff9	b217d1af-7781-4e6b-b969-516d49738da6	\N	39efce22-9ca2-4b37-b50f-95474cd69aa1	1.0000	each	5.0000	2026-06-07 05:06:47.520898+00	2026-06-07 05:06:47.520898+00
93bc1dd3-b47c-423e-97ba-f41d0a4b2988	8818d2e4-799e-4eae-9a4f-f87a629583de	603fc1cd-8a88-47d7-b06c-2429947d0a35	\N	12.0000	g	132.0000	2026-06-07 05:13:45.693449+00	2026-06-07 05:13:45.698565+00
8726f02e-f6c8-4093-979f-620def88fa83	8b97582d-2cfe-42c1-b401-1ad3d82e7139	603fc1cd-8a88-47d7-b06c-2429947d0a35	\N	25.0000	g	275.0000	2026-06-07 05:17:23.14877+00	2026-06-07 05:17:23.15735+00
bd4979c9-e45b-471d-a9bc-725cc1b2151c	8b97582d-2cfe-42c1-b401-1ad3d82e7139	603fc1cd-8a88-47d7-b06c-2429947d0a35	\N	1.0000	g	11.0000	2026-06-07 05:17:23.150778+00	2026-06-07 05:17:23.15735+00
8b4806f9-79f3-415b-8004-778187673fb9	75499c9f-8a2b-4bd3-af72-62f35666d131	603fc1cd-8a88-47d7-b06c-2429947d0a35	\N	25.0000	g	275.0000	2026-06-07 05:17:27.350513+00	2026-06-07 05:17:27.350513+00
48b9ca50-abfb-4280-81b4-3cd34abafb6a	75499c9f-8a2b-4bd3-af72-62f35666d131	603fc1cd-8a88-47d7-b06c-2429947d0a35	\N	1.0000	g	11.0000	2026-06-07 05:17:27.352574+00	2026-06-07 05:17:27.352574+00
58774d01-baf3-4512-98af-87de8894c84d	4e3c7b51-a6ca-458b-b21f-a8ddf4f39ec1	603fc1cd-8a88-47d7-b06c-2429947d0a35	\N	25.0000	g	275.0000	2026-06-07 05:17:32.419257+00	2026-06-07 05:17:32.419257+00
dcecde33-7686-4947-9ebb-c9cbc527ddd2	4e3c7b51-a6ca-458b-b21f-a8ddf4f39ec1	603fc1cd-8a88-47d7-b06c-2429947d0a35	\N	1.0000	g	11.0000	2026-06-07 05:17:32.420983+00	2026-06-07 05:17:32.420983+00
1b82a4a3-4206-483e-909f-1aebf447afc0	86989037-b1ea-46e0-9c28-cb64a56fd9f6	4ef3a779-fad8-45e7-907a-f14c06e4af51	\N	1.0000	L	1.0000	2026-06-07 05:29:08.408793+00	2026-06-07 05:29:08.417685+00
c4feaa53-36fe-4fe2-a4a1-f654415b26ae	39d42fd0-0894-44cf-9cd3-8f9f565a81a5	d3f312d9-f794-4a45-851e-fd93aedacb6b	\N	200.0000	ml	0.7000	2026-06-13 11:03:38.574958+00	2026-06-13 11:03:38.583984+00
08df38a9-86a1-4639-b23d-f7ce10ef6d04	6baa5678-12a6-4f26-a917-c37044d79a6a	31842ce7-6f78-475e-bb73-17c8174f3e9f	\N	3.0000	each	1.2000	2026-06-13 11:18:08.915798+00	2026-06-13 11:18:08.926387+00
5e8af6b1-77e1-4743-9ea0-3d02699a6204	6baa5678-12a6-4f26-a917-c37044d79a6a	75782ca0-6b59-404d-a1d6-7d78a515812b	\N	10.0000	g	0.1500	2026-06-13 11:18:08.920509+00	2026-06-13 11:18:08.926387+00
\.


--
-- Data for Name: recipes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.recipes (id, venue_id, name, portion_count, menu_selling_price, total_batch_cost, food_cost_per_portion, food_cost_percentage, created_at, updated_at) FROM stdin;
a4991b71-445a-473a-add1-a7b19bbe01dc	70fbf7b7-b22d-44fa-87ec-3ac9dad027df	tes	1	\N	0.00	0.00	\N	2026-06-07 04:42:15.371897+00	2026-06-07 04:42:15.371898+00
52ccbcaf-2311-4243-a4a8-765b654d4631	70fbf7b7-b22d-44fa-87ec-3ac9dad027df	Test Recipe 2	1	\N	0.10	0.10	\N	2026-06-07 04:47:40.790103+00	2026-06-07 04:47:40.843613+00
39efce22-9ca2-4b37-b50f-95474cd69aa1	70fbf7b7-b22d-44fa-87ec-3ac9dad027df	jhhj	1	\N	5.00	5.00	\N	2026-06-07 04:49:24.910543+00	2026-06-07 04:49:24.922059+00
58642898-6dde-4595-9592-acc627386a00	70fbf7b7-b22d-44fa-87ec-3ac9dad027df	Milk	1	\N	6.60	6.60	\N	2026-06-07 05:03:42.490914+00	2026-06-07 05:03:42.535831+00
b217d1af-7781-4e6b-b969-516d49738da6	70fbf7b7-b22d-44fa-87ec-3ac9dad027df	Copy of Milk	1	\N	6.60	6.60	\N	2026-06-07 05:06:47.512325+00	2026-06-07 05:06:47.512326+00
8818d2e4-799e-4eae-9a4f-f87a629583de	49ac8102-5c89-4ffe-b1c9-8cbedba054a5	ewf	1	\N	132.00	132.00	\N	2026-06-07 05:13:45.689091+00	2026-06-07 05:13:45.698565+00
8b97582d-2cfe-42c1-b401-1ad3d82e7139	49ac8102-5c89-4ffe-b1c9-8cbedba054a5	Test	1	\N	286.00	286.00	\N	2026-06-07 05:17:23.143888+00	2026-06-07 05:17:23.15735+00
75499c9f-8a2b-4bd3-af72-62f35666d131	49ac8102-5c89-4ffe-b1c9-8cbedba054a5	Copy of Test	1	\N	286.00	286.00	\N	2026-06-07 05:17:27.34444+00	2026-06-07 05:17:27.344441+00
4e3c7b51-a6ca-458b-b21f-a8ddf4f39ec1	49ac8102-5c89-4ffe-b1c9-8cbedba054a5	Copy of Test (1)	1	\N	286.00	286.00	\N	2026-06-07 05:17:32.413089+00	2026-06-07 05:17:32.413089+00
86989037-b1ea-46e0-9c28-cb64a56fd9f6	21fca359-5d92-4493-8905-f8443364c58d	1111ASD	1	\N	1.00	1.00	\N	2026-06-07 05:29:08.404001+00	2026-06-07 05:29:08.417685+00
39d42fd0-0894-44cf-9cd3-8f9f565a81a5	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Testing	1	11.00	0.70	0.70	6.4	2026-06-13 11:03:38.54141+00	2026-06-13 11:03:38.583984+00
6baa5678-12a6-4f26-a917-c37044d79a6a	0f79312e-8edb-4e2f-b9f3-e307ceff0c65	Scrambled egg	1	10.00	1.35	1.35	13.5	2026-06-13 11:18:08.905622+00	2026-06-13 11:18:08.926387+00
\.


--
-- Data for Name: square_connections; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.square_connections (id, venue_id, square_merchant_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, last_synced_at, sync_status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: square_unmatched_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.square_unmatched_items (id, venue_id, square_item_name, square_item_price, status, mapped_recipe_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: subscription_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subscription_history (id, organisation_id, event_type, from_tier, to_tier, stripe_event_id, description, created_at) FROM stdin;
\.


--
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subscriptions (id, organisation_id, tier, stripe_customer_id, stripe_subscription_id, current_period_end, pending_downgrade_tier, payment_failed_at, created_at, updated_at) FROM stdin;
b62b6bf1-a944-4795-8e24-298096f9f689	00000000-0000-0000-0000-000000000001	PRO	\N	\N	\N	\N	\N	2026-06-06 13:59:55.339847+00	2026-06-07 03:42:06.43774+00
\.


--
-- Data for Name: system_config; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.system_config (venue_id, target_food_cost_percentage, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_organisation_roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_organisation_roles (id, user_id, organisation_id, is_admin, created_at, updated_at) FROM stdin;
f3c630c8-1de0-4025-81c5-1c09a14940bd	00000000-0000-0000-0000-000000000002	00000000-0000-0000-0000-000000000001	t	2026-06-06 13:59:55.341865+00	2026-06-06 13:59:55.341865+00
\.


--
-- Data for Name: user_venue_roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_venue_roles (id, user_id, venue_id, role, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, email, display_name, created_at, updated_at) FROM stdin;
00000000-0000-0000-0000-000000000002	test@example.com	Test User	2026-06-06 13:59:55.341226+00	2026-06-06 13:59:55.341226+00
\.


--
-- Data for Name: venues; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.venues (id, organisation_id, name, address, deleted_at, created_at, updated_at) FROM stdin;
0f79312e-8edb-4e2f-b9f3-e307ceff0c65	00000000-0000-0000-0000-000000000002	ATG	\N	\N	2026-06-07 05:11:51.744833+00	2026-06-07 07:33:12.242634+00
21fca359-5d92-4493-8905-f8443364c58d	00000000-0000-0000-0000-000000000002	CC	\N	\N	2026-06-07 05:28:29.537768+00	2026-06-07 07:33:12.242634+00
49ac8102-5c89-4ffe-b1c9-8cbedba054a5	00000000-0000-0000-0000-000000000002	A	\N	2026-06-13 11:25:24.341134+00	2026-06-07 05:13:26.704019+00	2026-06-13 11:25:24.338962+00
f56d7f13-6ba2-41fc-999b-d13bd6fd1ac8	00000000-0000-0000-0000-000000000002	AAA	\N	2026-06-13 11:26:40.250316+00	2026-06-07 03:42:47.323852+00	2026-06-13 11:26:40.247574+00
70fbf7b7-b22d-44fa-87ec-3ac9dad027df	00000000-0000-0000-0000-000000000002	Test	\N	2026-06-13 11:26:47.979534+00	2026-06-07 04:23:52.983357+00	2026-06-13 11:26:47.978128+00
b597e372-f915-4553-b3ba-ad50474610af	00000000-0000-0000-0000-000000000002	Viks	\N	2026-06-13 11:26:54.570702+00	2026-06-07 03:28:21.493168+00	2026-06-13 11:26:54.568997+00
c38fe05a-eaec-4c9f-8d41-82f8732e4bbc	00000000-0000-0000-0000-000000000002	Test Venue	123 Test St	2026-06-13 11:27:02.366444+00	2026-06-07 03:12:34.093644+00	2026-06-13 11:27:02.364997+00
\.


--
-- Name: ai_insights ai_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_insights
    ADD CONSTRAINT ai_insights_pkey PRIMARY KEY (id);


--
-- Name: flyway_schema_history flyway_schema_history_pk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.flyway_schema_history
    ADD CONSTRAINT flyway_schema_history_pk PRIMARY KEY (installed_rank);


--
-- Name: ingredients ingredients_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_pkey PRIMARY KEY (id);


--
-- Name: invoice_line_items invoice_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_line_items
    ADD CONSTRAINT invoice_line_items_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: organisations organisations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organisations
    ADD CONSTRAINT organisations_pkey PRIMARY KEY (id);


--
-- Name: recipe_ingredient_lines recipe_ingredient_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipe_ingredient_lines
    ADD CONSTRAINT recipe_ingredient_lines_pkey PRIMARY KEY (id);


--
-- Name: recipes recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_pkey PRIMARY KEY (id);


--
-- Name: square_connections square_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.square_connections
    ADD CONSTRAINT square_connections_pkey PRIMARY KEY (id);


--
-- Name: square_connections square_connections_venue_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.square_connections
    ADD CONSTRAINT square_connections_venue_id_key UNIQUE (venue_id);


--
-- Name: square_unmatched_items square_unmatched_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.square_unmatched_items
    ADD CONSTRAINT square_unmatched_items_pkey PRIMARY KEY (id);


--
-- Name: subscription_history subscription_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscription_history
    ADD CONSTRAINT subscription_history_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_organisation_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_organisation_id_key UNIQUE (organisation_id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: system_config system_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_pkey PRIMARY KEY (venue_id);


--
-- Name: user_organisation_roles user_organisation_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_organisation_roles
    ADD CONSTRAINT user_organisation_roles_pkey PRIMARY KEY (id);


--
-- Name: user_organisation_roles user_organisation_roles_user_id_organisation_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_organisation_roles
    ADD CONSTRAINT user_organisation_roles_user_id_organisation_id_key UNIQUE (user_id, organisation_id);


--
-- Name: user_venue_roles user_venue_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_venue_roles
    ADD CONSTRAINT user_venue_roles_pkey PRIMARY KEY (id);


--
-- Name: user_venue_roles user_venue_roles_user_id_venue_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_venue_roles
    ADD CONSTRAINT user_venue_roles_user_id_venue_id_key UNIQUE (user_id, venue_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: venues venues_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_pkey PRIMARY KEY (id);


--
-- Name: flyway_schema_history_s_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX flyway_schema_history_s_idx ON public.flyway_schema_history USING btree (success);


--
-- Name: idx_ai_insights_generated_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_insights_generated_at ON public.ai_insights USING btree (generated_at DESC);


--
-- Name: idx_ai_insights_insight_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_insights_insight_type ON public.ai_insights USING btree (insight_type);


--
-- Name: idx_ai_insights_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_insights_status ON public.ai_insights USING btree (status);


--
-- Name: idx_ai_insights_venue_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_insights_venue_id ON public.ai_insights USING btree (venue_id);


--
-- Name: idx_ingredients_venue_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ingredients_venue_id ON public.ingredients USING btree (venue_id);


--
-- Name: idx_ingredients_venue_name_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_ingredients_venue_name_unique ON public.ingredients USING btree (venue_id, lower((name)::text));


--
-- Name: idx_invoice_line_items_invoice_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_line_items_invoice_id ON public.invoice_line_items USING btree (invoice_id);


--
-- Name: idx_invoice_line_items_matched_ingredient_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_line_items_matched_ingredient_id ON public.invoice_line_items USING btree (matched_ingredient_id);


--
-- Name: idx_invoice_line_items_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_line_items_status ON public.invoice_line_items USING btree (status);


--
-- Name: idx_invoices_processing_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoices_processing_status ON public.invoices USING btree (processing_status);


--
-- Name: idx_invoices_upload_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoices_upload_date ON public.invoices USING btree (upload_date DESC);


--
-- Name: idx_invoices_uploaded_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoices_uploaded_by ON public.invoices USING btree (uploaded_by);


--
-- Name: idx_invoices_venue_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoices_venue_id ON public.invoices USING btree (venue_id);


--
-- Name: idx_recipe_ingredient_lines_ingredient_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_recipe_ingredient_lines_ingredient_id ON public.recipe_ingredient_lines USING btree (ingredient_id);


--
-- Name: idx_recipe_ingredient_lines_recipe_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_recipe_ingredient_lines_recipe_id ON public.recipe_ingredient_lines USING btree (recipe_id);


--
-- Name: idx_recipe_ingredient_lines_sub_recipe_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_recipe_ingredient_lines_sub_recipe_id ON public.recipe_ingredient_lines USING btree (sub_recipe_id);


--
-- Name: idx_recipes_venue_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_recipes_venue_id ON public.recipes USING btree (venue_id);


--
-- Name: idx_recipes_venue_name_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_recipes_venue_name_unique ON public.recipes USING btree (venue_id, lower((name)::text));


--
-- Name: idx_square_connections_last_synced_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_square_connections_last_synced_at ON public.square_connections USING btree (last_synced_at);


--
-- Name: idx_square_connections_venue_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_square_connections_venue_id ON public.square_connections USING btree (venue_id);


--
-- Name: idx_square_unmatched_items_mapped_recipe_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_square_unmatched_items_mapped_recipe_id ON public.square_unmatched_items USING btree (mapped_recipe_id);


--
-- Name: idx_square_unmatched_items_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_square_unmatched_items_status ON public.square_unmatched_items USING btree (status);


--
-- Name: idx_square_unmatched_items_venue_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_square_unmatched_items_venue_id ON public.square_unmatched_items USING btree (venue_id);


--
-- Name: idx_subscription_history_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_subscription_history_created_at ON public.subscription_history USING btree (created_at DESC);


--
-- Name: idx_subscription_history_event_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_subscription_history_event_type ON public.subscription_history USING btree (event_type);


--
-- Name: idx_subscription_history_organisation_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_subscription_history_organisation_id ON public.subscription_history USING btree (organisation_id);


--
-- Name: idx_subscriptions_organisation_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_subscriptions_organisation_id ON public.subscriptions USING btree (organisation_id);


--
-- Name: idx_user_organisation_roles_organisation_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_organisation_roles_organisation_id ON public.user_organisation_roles USING btree (organisation_id);


--
-- Name: idx_user_organisation_roles_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_organisation_roles_user_id ON public.user_organisation_roles USING btree (user_id);


--
-- Name: idx_user_venue_roles_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_venue_roles_user_id ON public.user_venue_roles USING btree (user_id);


--
-- Name: idx_user_venue_roles_venue_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_venue_roles_venue_id ON public.user_venue_roles USING btree (venue_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_venues_deleted_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_venues_deleted_at ON public.venues USING btree (deleted_at);


--
-- Name: idx_venues_organisation_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_venues_organisation_id ON public.venues USING btree (organisation_id);


--
-- Name: idx_venues_organisation_name_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_venues_organisation_name_unique ON public.venues USING btree (organisation_id, lower((name)::text)) WHERE (deleted_at IS NULL);


--
-- Name: ai_insights update_ai_insights_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_ai_insights_updated_at BEFORE UPDATE ON public.ai_insights FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ingredients update_ingredients_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_ingredients_updated_at BEFORE UPDATE ON public.ingredients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: invoice_line_items update_invoice_line_items_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_invoice_line_items_updated_at BEFORE UPDATE ON public.invoice_line_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: invoices update_invoices_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: organisations update_organisations_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_organisations_updated_at BEFORE UPDATE ON public.organisations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: recipe_ingredient_lines update_recipe_ingredient_lines_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_recipe_ingredient_lines_updated_at BEFORE UPDATE ON public.recipe_ingredient_lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: recipes update_recipes_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_recipes_updated_at BEFORE UPDATE ON public.recipes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: square_connections update_square_connections_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_square_connections_updated_at BEFORE UPDATE ON public.square_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: square_unmatched_items update_square_unmatched_items_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_square_unmatched_items_updated_at BEFORE UPDATE ON public.square_unmatched_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: subscriptions update_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: system_config update_system_config_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON public.system_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_organisation_roles update_user_organisation_roles_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_user_organisation_roles_updated_at BEFORE UPDATE ON public.user_organisation_roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_venue_roles update_user_venue_roles_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_user_venue_roles_updated_at BEFORE UPDATE ON public.user_venue_roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: venues update_venues_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_venues_updated_at BEFORE UPDATE ON public.venues FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ai_insights ai_insights_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_insights
    ADD CONSTRAINT ai_insights_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;


--
-- Name: ingredients ingredients_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;


--
-- Name: invoice_line_items invoice_line_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_line_items
    ADD CONSTRAINT invoice_line_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_line_items invoice_line_items_matched_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_line_items
    ADD CONSTRAINT invoice_line_items_matched_ingredient_id_fkey FOREIGN KEY (matched_ingredient_id) REFERENCES public.ingredients(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;


--
-- Name: recipe_ingredient_lines recipe_ingredient_lines_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipe_ingredient_lines
    ADD CONSTRAINT recipe_ingredient_lines_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT;


--
-- Name: recipe_ingredient_lines recipe_ingredient_lines_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipe_ingredient_lines
    ADD CONSTRAINT recipe_ingredient_lines_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;


--
-- Name: recipe_ingredient_lines recipe_ingredient_lines_sub_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipe_ingredient_lines
    ADD CONSTRAINT recipe_ingredient_lines_sub_recipe_id_fkey FOREIGN KEY (sub_recipe_id) REFERENCES public.recipes(id) ON DELETE RESTRICT;


--
-- Name: recipes recipes_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;


--
-- Name: square_connections square_connections_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.square_connections
    ADD CONSTRAINT square_connections_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;


--
-- Name: square_unmatched_items square_unmatched_items_mapped_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.square_unmatched_items
    ADD CONSTRAINT square_unmatched_items_mapped_recipe_id_fkey FOREIGN KEY (mapped_recipe_id) REFERENCES public.recipes(id) ON DELETE SET NULL;


--
-- Name: square_unmatched_items square_unmatched_items_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.square_unmatched_items
    ADD CONSTRAINT square_unmatched_items_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;


--
-- Name: subscription_history subscription_history_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscription_history
    ADD CONSTRAINT subscription_history_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: system_config system_config_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;


--
-- Name: user_organisation_roles user_organisation_roles_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_organisation_roles
    ADD CONSTRAINT user_organisation_roles_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- Name: user_organisation_roles user_organisation_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_organisation_roles
    ADD CONSTRAINT user_organisation_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_venue_roles user_venue_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_venue_roles
    ADD CONSTRAINT user_venue_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_venue_roles user_venue_roles_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_venue_roles
    ADD CONSTRAINT user_venue_roles_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;


--
-- Name: venues venues_organisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES public.organisations(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict oJj94sdGpzKWObmUmPt03vH3dfoYGuYqWqLVoa27V1pueQM8ciSJeS22DgLcb8V

